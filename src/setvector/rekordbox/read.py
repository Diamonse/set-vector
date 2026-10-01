"""Read a Rekordbox collection export into immutable records."""

import xml.etree.ElementTree as ET
from collections.abc import Mapping
from pathlib import Path
from xml.parsers import expat

from setvector.domain import InputError

from .model import PositionMark, RekordboxLibrary, RekordboxTrack, TempoMarker

_TYPE_TO_KIND = {"0": "cue", "1": "fade_in", "2": "fade_out", "3": "load", "4": "loop"}
_TEMPO_FIELDS = {"Inizio", "Bpm", "Metro", "Battito"}
_MARK_FIELDS = {"Name", "Type", "Start", "End", "Num", "Red", "Green", "Blue"}
_COLOUR = ("Red", "Green", "Blue")


class _RejectedDeclaration(Exception):
    """Raised internally when a pre-scan finds a DOCTYPE or entity declaration."""


def read_library(path: str | Path) -> RekordboxLibrary:
    """Read a Rekordbox XML file; unreadable or invalid documents raise ``InputError``."""
    source = Path(path)
    try:
        data = source.read_bytes()
    except OSError as error:
        raise InputError(f"cannot read Rekordbox XML {source}: {error}") from error
    return parse_library(data, str(source))


def parse_library(data: bytes, source: str = "Rekordbox XML") -> RekordboxLibrary:
    """Parse Rekordbox XML bytes. Playlists are not read.

    Documents declaring a DOCTYPE or entities are refused, whatever their encoding;
    Rekordbox never writes them.
    """
    _reject_doctype_and_entities(data, source)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise InputError(f"{source} is not valid XML: {error}") from error
    if root.tag != "DJ_PLAYLISTS":
        raise InputError(f"{source} is not a Rekordbox XML export (root is {root.tag})")
    collection = root.find("COLLECTION")
    if collection is None:
        raise InputError(f"{source} has no COLLECTION")
    tracks = []
    for index, element in enumerate(collection.findall("TRACK"), 1):
        label = element.get("TrackID") or f"#{index}"
        try:
            tracks.append(_track(element))
        except KeyError as error:
            raise InputError(
                f"{source}: track {label}: missing attribute {error.args[0]}"
            ) from error
        except ValueError as error:
            raise InputError(f"{source}: track {label}: {error}") from error
    product = root.find("PRODUCT")
    try:
        return RekordboxLibrary(
            product.get("Name") if product is not None else None,
            product.get("Version") if product is not None else None,
            tuple(tracks),
        )
    except ValueError as error:
        raise InputError(f"{source}: {error}") from error


def _track(element: ET.Element) -> RekordboxTrack:
    attributes = dict(element.attrib)
    track_id = _integer(attributes.pop("TrackID"), "TrackID")
    location = attributes.pop("Location")
    tempo, marks, extra = [], [], []
    for child in element:
        if child.tag == "TEMPO":
            tempo.append(_tempo(child.attrib))
        elif child.tag == "POSITION_MARK":
            marks.append(_mark(child.attrib))
        else:
            extra.append(_serialize(child))
    return RekordboxTrack(
        track_id, location, tuple(attributes.items()), tuple(tempo), tuple(marks), tuple(extra)
    )


def _tempo(attributes: Mapping[str, str]) -> TempoMarker:
    _check_fields(attributes, _TEMPO_FIELDS, "TEMPO")
    return TempoMarker(
        _number(attributes["Inizio"], "Inizio"),
        _number(attributes["Bpm"], "Bpm"),
        attributes["Metro"],
        _integer(attributes["Battito"], "Battito"),
    )


def _mark(attributes: Mapping[str, str]) -> PositionMark:
    _check_fields(attributes, _MARK_FIELDS, "POSITION_MARK")
    kind = _TYPE_TO_KIND.get(attributes["Type"])
    if kind is None:
        raise ValueError(f"unsupported POSITION_MARK Type {attributes['Type']}")
    number = _integer(attributes.get("Num", "-1"), "Num")
    present = [name in attributes for name in _COLOUR]
    if any(present) and not all(present):
        raise ValueError("POSITION_MARK needs all of Red, Green, Blue or none")
    colour = tuple(_integer(attributes[name], name) for name in _COLOUR) if all(present) else None
    end = _number(attributes["End"], "End") if "End" in attributes else None
    return PositionMark(
        attributes.get("Name", ""),
        kind,
        _number(attributes["Start"], "Start"),
        end,
        None if number == -1 else number,
        colour,
    )


def _check_fields(attributes: Mapping[str, str], allowed: set[str], tag: str) -> None:
    unknown = set(attributes) - allowed
    if unknown:
        raise ValueError(f"{tag} has unsupported attributes: {', '.join(sorted(unknown))}")


def _integer(text: str, field: str) -> int:
    try:
        return int(text)
    except ValueError as error:
        raise ValueError(f"{field} must be an integer") from error


def _number(text: str, field: str) -> float:
    try:
        return float(text)
    except ValueError as error:
        raise ValueError(f"{field} must be a number") from error


def _serialize(element: ET.Element) -> str:
    """Serialize an unknown element without insignificant whitespace, for a stable rewrite."""
    copy = ET.fromstring(ET.tostring(element))
    for node in copy.iter():
        if node.text is not None and not node.text.strip():
            node.text = None
        if node.tail is not None and not node.tail.strip():
            node.tail = None
    copy.tail = None
    return ET.tostring(copy, encoding="unicode")


def _reject_doctype_and_entities(data: bytes, source: str) -> None:
    """Pre-scan with expat so a DOCTYPE or entity is caught whatever the document's encoding."""
    parser = expat.ParserCreate()

    def _reject(*_args: object) -> None:
        raise _RejectedDeclaration

    parser.StartDoctypeDeclHandler = _reject
    parser.EntityDeclHandler = _reject
    try:
        parser.Parse(data, True)
    except _RejectedDeclaration as error:
        raise InputError(f"{source} must not contain a DOCTYPE or entity declarations") from error
    except expat.ExpatError as error:
        raise InputError(f"{source} is not valid XML: {error}") from error
