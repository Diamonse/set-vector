"""Validated rhythm analyses: a fitted beat grid, its bars, and how it was chosen."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from ._validation import finite_number, require_fields, validate_version
from .audio import nonempty_string, positive_integer, validate_sha256
from .bundle import ExtractorIdentity

SOURCES = ("beat_this", "setvector_fallback", "none")
CANDIDATES = ("beat_this", "setvector_fallback")

_SEGMENT_FIELDS = {"start_seconds", "bpm", "beat_count", "first_bar_position"}
_QUALITY_FIELDS = {
    "beat_count",
    "interval_cv",
    "grid_fit",
    "segment_count",
    "modal_bar_length",
    "bar_regularity",
}
_RHYTHM_FIELDS = {
    "schema_version",
    "rhythm_id",
    "asset_id",
    "feature_id",
    "extractor",
    "source",
    "grid_segments",
    "beats",
    "bar_positions",
    "detected_beats",
    "tempo_bpm",
    "quality",
    "reliable",
    "reasons",
}


def _array(value: object, field: str) -> tuple[object, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{field} must be an array")
    return tuple(value)


def _times(value: object, field: str) -> tuple[float, ...]:
    times = tuple(finite_number(item, field) for item in _array(value, field))
    if any(t < 0 for t in times) or any(b <= a for a, b in zip(times, times[1:], strict=False)):
        raise ValueError(f"{field} must be nonnegative and strictly increasing")
    return times


def _optional_fraction(value: object, field: str) -> float | None:
    if value is None:
        return None
    number = finite_number(value, field)
    if not 0.0 <= number <= 1.0:
        raise ValueError(f"{field} must be between 0 and 1")
    return number


def _count(value: object, field: str) -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"{field} must be a nonnegative integer")
    return value


@dataclass(frozen=True, slots=True)
class GridSegment:
    """Constant-tempo grid beats ``start_seconds + n * 60 / bpm``."""

    start_seconds: float
    bpm: float
    beat_count: int
    first_bar_position: int | None

    def __post_init__(self) -> None:
        start = finite_number(self.start_seconds, "start_seconds")
        if start < 0:
            raise ValueError("start_seconds must be nonnegative")
        bpm = finite_number(self.bpm, "bpm")
        if bpm <= 0:
            raise ValueError("bpm must be positive")
        positive_integer(self.beat_count, "beat_count")
        if self.first_bar_position is not None:
            positive_integer(self.first_bar_position, "first_bar_position")
        object.__setattr__(self, "start_seconds", start)
        object.__setattr__(self, "bpm", bpm)

    def times(self) -> tuple[float, ...]:
        """Return this segment's grid beat times."""
        period = 60.0 / self.bpm
        return tuple(self.start_seconds + n * period for n in range(self.beat_count))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "GridSegment":
        """Read one complete grid segment."""
        require_fields(data, _SEGMENT_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return a detached JSON-compatible grid segment."""
        return {
            "start_seconds": self.start_seconds,
            "bpm": self.bpm,
            "beat_count": self.beat_count,
            "first_bar_position": self.first_bar_position,
        }


@dataclass(frozen=True, slots=True)
class CandidateQuality:
    """Measurements used to accept or reject one beat-grid candidate."""

    beat_count: int
    interval_cv: float | None
    grid_fit: float | None
    segment_count: int
    modal_bar_length: int | None
    bar_regularity: float | None

    def __post_init__(self) -> None:
        _count(self.beat_count, "beat_count")
        _count(self.segment_count, "segment_count")
        if self.interval_cv is not None:
            cv = finite_number(self.interval_cv, "interval_cv")
            if cv < 0:
                raise ValueError("interval_cv must be nonnegative")
            object.__setattr__(self, "interval_cv", cv)
        object.__setattr__(self, "grid_fit", _optional_fraction(self.grid_fit, "grid_fit"))
        object.__setattr__(
            self, "bar_regularity", _optional_fraction(self.bar_regularity, "bar_regularity")
        )
        if self.modal_bar_length is not None:
            positive_integer(self.modal_bar_length, "modal_bar_length")
        if (self.modal_bar_length is None) != (self.bar_regularity is None):
            raise ValueError("modal_bar_length and bar_regularity must both be present or absent")

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "CandidateQuality":
        """Read complete candidate measurements."""
        require_fields(data, _QUALITY_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible candidate measurements."""
        return {
            "beat_count": self.beat_count,
            "interval_cv": self.interval_cv,
            "grid_fit": self.grid_fit,
            "segment_count": self.segment_count,
            "modal_bar_length": self.modal_bar_length,
            "bar_regularity": self.bar_regularity,
        }


@dataclass(frozen=True, slots=True)
class RhythmAnalysis:
    """The beat grid chosen for one baseline feature artifact, with its provenance."""

    rhythm_id: str
    asset_id: str
    feature_id: str
    extractor: ExtractorIdentity
    source: str
    grid_segments: tuple[GridSegment, ...]
    beats: tuple[float, ...]
    bar_positions: tuple[int | None, ...]
    detected_beats: tuple[float, ...]
    tempo_bpm: float | None
    quality: Mapping[str, CandidateQuality]
    reliable: bool
    reasons: tuple[str, ...]
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        for name in ("rhythm_id", "asset_id", "feature_id"):
            object.__setattr__(self, name, validate_sha256(getattr(self, name), name))
        if not isinstance(self.extractor, ExtractorIdentity):
            raise ValueError("extractor must be ExtractorIdentity")
        if self.source not in SOURCES:
            raise ValueError(f"source must be one of {', '.join(SOURCES)}")
        segments = _array(self.grid_segments, "grid_segments")
        if not all(isinstance(segment, GridSegment) for segment in segments):
            raise ValueError("grid_segments must contain GridSegment values")
        beats = _times(self.beats, "beats")
        if beats != tuple(t for segment in segments for t in segment.times()):
            raise ValueError("beats must equal the times generated by grid_segments")
        positions = _array(self.bar_positions, "bar_positions")
        if len(positions) != len(beats):
            raise ValueError("bar_positions must have one entry per beat")
        known = [p is not None for p in positions]
        if any(known) and not all(known):
            raise ValueError("bar_positions must be all known or all null")
        if any(type(p) is not int or p < 1 for p in positions if p is not None):
            raise ValueError("bar_positions must be positive integers")
        start = 0
        for segment in segments:
            if segment.first_bar_position != positions[start]:
                raise ValueError("first_bar_position must equal the segment's first bar position")
            start += segment.beat_count
        detected = _times(self.detected_beats, "detected_beats")
        if not isinstance(self.quality, Mapping):
            raise ValueError("quality must be an object")
        quality = dict(sorted(self.quality.items()))
        if any(name not in CANDIDATES for name in quality) or not all(
            isinstance(value, CandidateQuality) for value in quality.values()
        ):
            raise ValueError(f"quality keys must be among {', '.join(CANDIDATES)}")
        if type(self.reliable) is not bool:
            raise ValueError("reliable must be a boolean")
        reasons = tuple(nonempty_string(r, "reasons") for r in _array(self.reasons, "reasons"))
        if self.reliable != (self.source != "none"):
            raise ValueError("reliable must be true exactly when source is not none")
        if self.source == "none":
            if segments or detected or self.tempo_bpm is not None:
                raise ValueError("source none must have no grid, detected beats, or tempo_bpm")
        else:
            if not segments or self.source not in quality:
                raise ValueError("a selected source needs grid_segments and its quality")
            dominant = max(segments, key=lambda segment: segment.beat_count)
            if self.tempo_bpm != dominant.bpm:
                raise ValueError("tempo_bpm must equal the bpm of the longest segment")
        if self.source == "setvector_fallback" and any(known):
            raise ValueError("setvector_fallback grids have no bar positions")
        object.__setattr__(self, "grid_segments", segments)
        object.__setattr__(self, "beats", beats)
        object.__setattr__(self, "bar_positions", positions)
        object.__setattr__(self, "detected_beats", detected)
        object.__setattr__(self, "quality", MappingProxyType(quality))
        object.__setattr__(self, "reasons", reasons)

    @property
    def downbeats(self) -> tuple[float, ...]:
        """Grid beats at bar position 1."""
        return tuple(t for t, p in zip(self.beats, self.bar_positions, strict=True) if p == 1)

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "RhythmAnalysis":
        """Read a complete rhythm analysis with strict nested schemas."""
        require_fields(data, _RHYTHM_FIELDS)
        values = dict(data)
        values["extractor"] = ExtractorIdentity.from_dict(values["extractor"])
        values["grid_segments"] = tuple(
            GridSegment.from_dict(item) for item in _array(values["grid_segments"], "grid_segments")
        )
        if not isinstance(values["quality"], Mapping):
            raise ValueError("quality must be an object")
        values["quality"] = {
            name: CandidateQuality.from_dict(item) for name, item in values["quality"].items()
        }
        for name in ("beats", "bar_positions", "detected_beats", "reasons"):
            values[name] = _array(values[name], name)
        return cls(**values)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible rhythm analysis."""
        return {
            "schema_version": self.schema_version,
            "rhythm_id": self.rhythm_id,
            "asset_id": self.asset_id,
            "feature_id": self.feature_id,
            "extractor": self.extractor.to_dict(),
            "source": self.source,
            "grid_segments": [segment.to_dict() for segment in self.grid_segments],
            "beats": list(self.beats),
            "bar_positions": list(self.bar_positions),
            "detected_beats": list(self.detected_beats),
            "tempo_bpm": self.tempo_bpm,
            "quality": {name: value.to_dict() for name, value in self.quality.items()},
            "reliable": self.reliable,
            "reasons": list(self.reasons),
        }
