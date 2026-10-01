"""Render Rekordbox XML and check that it reads back unchanged."""

import xml.etree.ElementTree as ET
from collections.abc import Sequence

from setvector import __version__
from setvector.domain import ArtifactError, InputError

from .model import PositionMark, RekordboxTrack
from .read import parse_library

_KIND_TO_TYPE = {"cue": "0", "fade_in": "1", "fade_out": "2", "load": "3", "loop": "4"}
_DECLARATION = b'<?xml version="1.0" encoding="UTF-8"?>\n'


def format_decimal(value: float, places: int) -> str:
    """Format without locale, using ``places`` decimals unless more are needed to round-trip."""
    value = value + 0.0  # normalize -0.0 to 0.0
    for digits in range(places, 18):
        text = f"{value:.{digits}f}"
        if float(text) == value:
            return text
    return text


def render_library(tracks: Sequence[RekordboxTrack], playlist_name: str) -> bytes:
    """Return Rekordbox XML with ``tracks`` and one playlist listing them.

    Raises ``ArtifactError`` if the document does not read back to the same tracks.
    """
    tracks = tuple(tracks)
    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(root, "PRODUCT", Name="SetVector", Version=__version__, Company="SetVector")
    collection = ET.SubElement(root, "COLLECTION", Entries=str(len(tracks)))
    elements = [_track_element(collection, track) for track in tracks]
    playlists = ET.SubElement(root, "PLAYLISTS")
    folder = ET.SubElement(playlists, "NODE", Type="0", Name="ROOT", Count="1")
    playlist = ET.SubElement(
        folder, "NODE", Name=playlist_name, Type="1", KeyType="0", Entries=str(len(tracks))
    )
    for track in tracks:
        ET.SubElement(playlist, "TRACK", Key=str(track.track_id))
    ET.indent(root, space="  ")
    for element, track in zip(elements, tracks, strict=True):
        for raw in track.extra_elements:
            element.append(ET.fromstring(raw))
    data = _DECLARATION + ET.tostring(root, encoding="utf-8", xml_declaration=False) + b"\n"
    try:
        parsed = parse_library(data, "rendered Rekordbox XML")
    except InputError as error:
        raise ArtifactError(f"rendered Rekordbox XML does not read back: {error}") from error
    if parsed.tracks != tracks:
        raise ArtifactError("rendered Rekordbox XML does not read back identically")
    return data


def _track_element(parent: ET.Element, track: RekordboxTrack) -> ET.Element:
    element = ET.SubElement(parent, "TRACK", TrackID=str(track.track_id))
    for name, value in track.attributes:
        element.set(name, value)
    element.set("Location", track.location)
    for marker in track.tempo:
        ET.SubElement(
            element,
            "TEMPO",
            Inizio=format_decimal(marker.start_seconds, 3),
            Bpm=format_decimal(marker.bpm, 2),
            Metro=marker.meter,
            Battito=str(marker.beat_in_bar),
        )
    for mark in track.marks:
        ET.SubElement(element, "POSITION_MARK", _mark_attributes(mark))
    return element


def _mark_attributes(mark: PositionMark) -> dict[str, str]:
    attributes = {
        "Name": mark.name,
        "Type": _KIND_TO_TYPE[mark.kind],
        "Start": format_decimal(mark.start_seconds, 3),
    }
    if mark.end_seconds is not None:
        attributes["End"] = format_decimal(mark.end_seconds, 3)
    attributes["Num"] = "-1" if mark.slot is None else str(mark.slot)
    if mark.colour is not None:
        attributes.update(zip(("Red", "Green", "Blue"), map(str, mark.colour), strict=True))
    return attributes
