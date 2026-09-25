"""Immutable records read from and written to Rekordbox XML."""

import re
from dataclasses import dataclass
from pathlib import Path, PurePath
from urllib.parse import quote, unquote

from setvector.domain._validation import finite_number

HOT_CUE_SLOTS = 8
SETVECTOR_PREFIX = "SV "
MARK_KINDS = ("cue", "fade_in", "fade_out", "load", "loop")
_LOCAL_PREFIX = "file://localhost/"
_DRIVE = re.compile(r"^[A-Za-z]:/")
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_METER = re.compile(r"^([1-9][0-9]*)/([1-9][0-9]*)$")


def _nonnegative(value: object, field: str) -> float:
    number = finite_number(value, field)
    if number < 0:
        raise ValueError(f"{field} must be nonnegative")
    return number


def _typed_tuple(value: object, item_type: type, message: str) -> tuple:
    """Return a tuple copy of ``value``, requiring a sequence of ``item_type`` values."""
    if not isinstance(value, (tuple, list)):
        raise ValueError(message)
    items = tuple(value)
    if not all(isinstance(item, item_type) for item in items):
        raise ValueError(message)
    return items


def validate_colour(value: object) -> tuple[int, int, int] | None:
    """Return an RGB triple of integers from 0 to 255, or ``None``."""
    if value is None:
        return None
    colour = tuple(value) if isinstance(value, (tuple, list)) else ()
    if len(colour) != 3 or any(type(c) is not int or not 0 <= c <= 255 for c in colour):
        raise ValueError("colour must be three integers from 0 to 255")
    return colour


def path_from_location(location: str) -> Path | None:
    """Decode a ``file://localhost/`` URI; streaming and other locations give ``None``."""
    if not location.startswith(_LOCAL_PREFIX):
        return None
    rest = unquote(location[len(_LOCAL_PREFIX) :])
    if _DRIVE.match(rest):
        return Path(rest)
    if _SCHEME.match(rest):
        return None
    return Path("/" + rest)


def location_for_path(path: PurePath) -> str:
    """Encode an absolute local path the way Rekordbox writes ``Location``."""
    posix = path.as_posix()
    if _DRIVE.match(posix):
        return _LOCAL_PREFIX + posix[:3] + quote(posix[3:], safe="/")
    if not posix.startswith("/"):
        raise ValueError(f"path must be absolute: {posix}")
    return _LOCAL_PREFIX + quote(posix[1:], safe="/")


@dataclass(frozen=True, slots=True)
class TempoMarker:
    """A Rekordbox ``TEMPO`` anchor: a beat at ``start_seconds`` and the grid after it."""

    start_seconds: float
    bpm: float
    meter: str
    beat_in_bar: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "start_seconds", _nonnegative(self.start_seconds, "Inizio"))
        bpm = finite_number(self.bpm, "Bpm")
        if bpm <= 0:
            raise ValueError("Bpm must be positive")
        object.__setattr__(self, "bpm", bpm)
        if not isinstance(self.meter, str) or _METER.fullmatch(self.meter) is None:
            raise ValueError("Metro must look like 4/4")
        if type(self.beat_in_bar) is not int or not 1 <= self.beat_in_bar <= self.beats_per_bar:
            raise ValueError("Battito must be a beat number within the bar")

    @property
    def beats_per_bar(self) -> int:
        """The meter's numerator."""
        return int(self.meter.split("/")[0])


@dataclass(frozen=True, slots=True)
class PositionMark:
    """A Rekordbox ``POSITION_MARK``: a memory cue (``slot`` None) or hot cue A-H (0-7)."""

    name: str
    kind: str
    start_seconds: float
    end_seconds: float | None = None
    slot: int | None = None
    colour: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.name, str):
            raise ValueError("Name must be text")
        if self.kind not in MARK_KINDS:
            raise ValueError(f"kind must be one of {', '.join(MARK_KINDS)}")
        start = _nonnegative(self.start_seconds, "Start")
        object.__setattr__(self, "start_seconds", start)
        if self.end_seconds is not None:
            end = finite_number(self.end_seconds, "End")
            if end <= start:
                raise ValueError("End must be after Start")
            object.__setattr__(self, "end_seconds", end)
        if self.kind == "loop" and self.end_seconds is None:
            raise ValueError("a loop needs End")
        if self.slot is not None and (
            type(self.slot) is not int or not 0 <= self.slot < HOT_CUE_SLOTS
        ):
            raise ValueError("Num must be -1 or a hot cue slot from 0 to 7")
        object.__setattr__(self, "colour", validate_colour(self.colour))

    @property
    def is_setvector(self) -> bool:
        """Whether SetVector wrote this mark, judged by its name prefix."""
        return self.name.startswith(SETVECTOR_PREFIX)


@dataclass(frozen=True, slots=True)
class RekordboxTrack:
    """One ``COLLECTION/TRACK`` record; ``attributes`` keeps every other attribute verbatim."""

    track_id: int
    location: str
    attributes: tuple[tuple[str, str], ...] = ()
    tempo: tuple[TempoMarker, ...] = ()
    marks: tuple[PositionMark, ...] = ()
    extra_elements: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if type(self.track_id) is not int or self.track_id <= 0:
            raise ValueError("TrackID must be a positive integer")
        if not isinstance(self.location, str) or not self.location:
            raise ValueError("Location must be a nonempty URI")
        if not isinstance(self.attributes, (tuple, list)) or not all(
            isinstance(pair, (tuple, list))
            and len(pair) == 2
            and type(pair[0]) is str
            and type(pair[1]) is str
            for pair in self.attributes
        ):
            raise ValueError("attributes must be pairs of text")
        attributes = tuple((name, value) for name, value in self.attributes)
        if any(name in ("TrackID", "Location") for name, _ in attributes):
            raise ValueError("attributes must not repeat TrackID or Location")
        object.__setattr__(self, "attributes", attributes)
        object.__setattr__(
            self,
            "tempo",
            _typed_tuple(self.tempo, TempoMarker, "tempo must contain TempoMarker values"),
        )
        object.__setattr__(
            self,
            "marks",
            _typed_tuple(self.marks, PositionMark, "marks must contain PositionMark values"),
        )
        object.__setattr__(
            self,
            "extra_elements",
            _typed_tuple(self.extra_elements, str, "extra_elements must contain XML text"),
        )

    @property
    def path(self) -> Path | None:
        """The local audio file, or ``None`` for streaming and other non-file locations."""
        return path_from_location(self.location)

    def attribute(self, name: str, default: str | None = None) -> str | None:
        """Return one of the verbatim ``TRACK`` attributes."""
        return dict(self.attributes).get(name, default)


@dataclass(frozen=True, slots=True)
class RekordboxLibrary:
    """The product that wrote an XML document and its collection tracks."""

    product_name: str | None
    product_version: str | None
    tracks: tuple[RekordboxTrack, ...]

    def __post_init__(self) -> None:
        if self.product_name is not None and not isinstance(self.product_name, str):
            raise ValueError("product_name must be None or text")
        if self.product_version is not None and not isinstance(self.product_version, str):
            raise ValueError("product_version must be None or text")
        tracks = _typed_tuple(
            self.tracks, RekordboxTrack, "tracks must contain RekordboxTrack values"
        )
        seen: set[int] = set()
        for track in tracks:
            if track.track_id in seen:
                raise ValueError(f"duplicate TrackID {track.track_id}")
            seen.add(track.track_id)
        object.__setattr__(self, "tracks", tracks)
