"""Immutable aligned feature measurements and their extraction identity."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import TypeAlias

from ._validation import finite_number, require_fields, validate_version
from .audio import nonempty_string, positive_integer, validate_sha256
from .config import AnalysisConfig
from .features import FeatureSeries

JsonScalar: TypeAlias = str | int | float | bool | None

_BEAT_FIELDS = {"frame_index", "seconds"}
_DIAGNOSTICS_FIELDS = {"analyzed_frames", "omitted_tail_samples", "warnings"}
_MEASUREMENTS_FIELDS = {
    "rms",
    "spectral_centroid",
    "bass_power_ratio",
    "onset_strength",
    "tempo_bpm",
    "beats",
    "diagnostics",
}
_EXTRACTOR_FIELDS = {
    "name",
    "algorithm_version",
    "package_version",
    "config",
    "parameters",
    "dependency_versions",
    "schema_version",
}
_BUNDLE_FIELDS = {
    "feature_id",
    "asset_id",
    "config_id",
    "extractor",
    "measurements",
    "schema_version",
}
_SERIES_REQUIREMENTS = {
    "rms": "linear_amplitude",
    "spectral_centroid": "Hz",
    "bass_power_ratio": "ratio",
    "onset_strength": "normalized_flux",
}


def _sequence(value: object, field: str) -> tuple[object, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{field} must be an array")
    return tuple(value)


def _json_scalar(value: object, field: str) -> JsonScalar:
    if value is None or isinstance(value, (str, bool)):
        return value
    if type(value) is int:
        finite_number(value, field)
        return value
    if type(value) is float:
        finite_number(value, field)
        return value
    raise ValueError(f"{field} values must be JSON scalars")


def _immutable_mapping(value: object, field: str, scalar: bool) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be an object")
    copied: dict[str, object] = {}
    for key, item in value.items():
        key = nonempty_string(key, field)
        if scalar:
            copied[key] = _json_scalar(item, field)
        else:
            copied[key] = nonempty_string(item, field)
    return MappingProxyType(dict(sorted(copied.items())))


@dataclass(frozen=True, slots=True)
class BeatPosition:
    """One detected beat aligned to a common feature frame."""

    frame_index: int
    seconds: float

    def __post_init__(self) -> None:
        if type(self.frame_index) is not int or self.frame_index < 0:
            raise ValueError("frame_index must be a nonnegative integer")
        seconds = finite_number(self.seconds, "seconds")
        if seconds < 0:
            raise ValueError("seconds must be nonnegative")
        object.__setattr__(self, "seconds", seconds)

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "BeatPosition":
        """Read one complete beat position."""
        require_fields(data, _BEAT_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return a detached JSON-compatible beat position."""
        return {"frame_index": self.frame_index, "seconds": self.seconds}


@dataclass(frozen=True, slots=True)
class AnalysisDiagnostics:
    """Frame accounting and non-fatal analysis warnings."""

    analyzed_frames: int
    omitted_tail_samples: int
    warnings: tuple[str, ...]

    def __post_init__(self) -> None:
        if type(self.analyzed_frames) is not int or self.analyzed_frames < 0:
            raise ValueError("analyzed_frames must be a nonnegative integer")
        if type(self.omitted_tail_samples) is not int or self.omitted_tail_samples < 0:
            raise ValueError("omitted_tail_samples must be a nonnegative integer")
        warnings = _sequence(self.warnings, "warnings")
        object.__setattr__(
            self,
            "warnings",
            tuple(nonempty_string(warning, "warnings") for warning in warnings),
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "AnalysisDiagnostics":
        """Read complete diagnostic metadata."""
        require_fields(data, _DIAGNOSTICS_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible diagnostics."""
        return {
            "analyzed_frames": self.analyzed_frames,
            "omitted_tail_samples": self.omitted_tail_samples,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class AnalysisMeasurements:
    """Four aligned baseline series plus track-level rhythm information."""

    rms: FeatureSeries
    spectral_centroid: FeatureSeries
    bass_power_ratio: FeatureSeries
    onset_strength: FeatureSeries
    tempo_bpm: float | None
    beats: tuple[BeatPosition, ...]
    diagnostics: AnalysisDiagnostics

    def __post_init__(self) -> None:
        series = {name: getattr(self, name) for name in _SERIES_REQUIREMENTS}
        for name, unit in _SERIES_REQUIREMENTS.items():
            item = series[name]
            if not isinstance(item, FeatureSeries):
                raise ValueError(f"{name} must be a FeatureSeries")
            if item.name != name or item.unit != unit:
                raise ValueError(f"{name} must have name {name!r} and unit {unit!r}")
        timing = (series["rms"].timestamps, series["rms"].window_starts, series["rms"].window_ends)
        for name, item in series.items():
            if (item.timestamps, item.window_starts, item.window_ends) != timing:
                raise ValueError(f"{name} timing arrays must match rms")
        if not isinstance(self.diagnostics, AnalysisDiagnostics):
            raise ValueError("diagnostics must be AnalysisDiagnostics")
        if self.diagnostics.analyzed_frames != len(series["rms"].values):
            raise ValueError("diagnostics.analyzed_frames must equal the rms frame count")
        beats = _sequence(self.beats, "beats")
        normalized_beats: list[BeatPosition] = []
        previous_index = -1
        for beat in beats:
            if not isinstance(beat, BeatPosition):
                raise ValueError("beats must contain BeatPosition values")
            if beat.frame_index <= previous_index or beat.frame_index >= len(
                series["rms"].timestamps
            ):
                raise ValueError("beats must have ordered in-range frame indices")
            if beat.seconds != series["rms"].timestamps[beat.frame_index]:
                raise ValueError("beats seconds must equal their indexed timestamps")
            previous_index = beat.frame_index
            normalized_beats.append(beat)
        object.__setattr__(self, "beats", tuple(normalized_beats))
        if not normalized_beats:
            object.__setattr__(self, "tempo_bpm", None)
        elif self.tempo_bpm is None:
            raise ValueError("tempo_bpm must be present when beats are present")
        else:
            tempo = finite_number(self.tempo_bpm, "tempo_bpm")
            if tempo <= 0:
                raise ValueError("tempo_bpm must be positive")
            object.__setattr__(self, "tempo_bpm", tempo)

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "AnalysisMeasurements":
        """Read complete measurements and recursively validate nested contracts."""
        require_fields(data, _MEASUREMENTS_FIELDS)
        values = dict(data)
        for name in _SERIES_REQUIREMENTS:
            values[name] = FeatureSeries.from_dict(values[name])
        values["beats"] = tuple(
            BeatPosition.from_dict(item) for item in _sequence(values["beats"], "beats")
        )
        values["diagnostics"] = AnalysisDiagnostics.from_dict(values["diagnostics"])
        return cls(**values)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible measurements."""
        return {
            **{name: getattr(self, name).to_dict() for name in _SERIES_REQUIREMENTS},
            "tempo_bpm": self.tempo_bpm,
            "beats": [beat.to_dict() for beat in self.beats],
            "diagnostics": self.diagnostics.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class ExtractorIdentity:
    """Versioned local extractor inputs used to identify feature artifacts."""

    name: str
    algorithm_version: int
    package_version: str
    config: AnalysisConfig
    parameters: Mapping[str, JsonScalar]
    dependency_versions: Mapping[str, str]
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        object.__setattr__(self, "name", nonempty_string(self.name, "name"))
        object.__setattr__(
            self,
            "algorithm_version",
            positive_integer(self.algorithm_version, "algorithm_version"),
        )
        object.__setattr__(
            self, "package_version", nonempty_string(self.package_version, "package_version")
        )
        if not isinstance(self.config, AnalysisConfig):
            raise ValueError("config must be AnalysisConfig")
        object.__setattr__(
            self, "parameters", _immutable_mapping(self.parameters, "parameters", True)
        )
        object.__setattr__(
            self,
            "dependency_versions",
            _immutable_mapping(self.dependency_versions, "dependency_versions", False),
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "ExtractorIdentity":
        """Read complete extractor provenance."""
        require_fields(data, _EXTRACTOR_FIELDS)
        values = dict(data)
        values["config"] = AnalysisConfig.from_dict(values["config"])
        return cls(**values)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible extractor provenance."""
        return {
            "name": self.name,
            "algorithm_version": self.algorithm_version,
            "package_version": self.package_version,
            "config": self.config.to_dict(),
            "parameters": dict(self.parameters),
            "dependency_versions": dict(self.dependency_versions),
            "schema_version": self.schema_version,
        }


@dataclass(frozen=True, slots=True)
class FeatureBundle:
    """Versioned baseline feature results for one content-addressed asset."""

    feature_id: str
    asset_id: str
    config_id: str
    extractor: ExtractorIdentity
    measurements: AnalysisMeasurements
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        object.__setattr__(self, "feature_id", validate_sha256(self.feature_id, "feature_id"))
        object.__setattr__(self, "asset_id", validate_sha256(self.asset_id, "asset_id"))
        object.__setattr__(self, "config_id", validate_sha256(self.config_id, "config_id"))
        if not isinstance(self.extractor, ExtractorIdentity):
            raise ValueError("extractor must be ExtractorIdentity")
        if self.config_id != self.extractor.config.config_id:
            raise ValueError("config_id must equal extractor.config.config_id")
        if not isinstance(self.measurements, AnalysisMeasurements):
            raise ValueError("measurements must be AnalysisMeasurements")

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "FeatureBundle":
        """Read a complete feature bundle with strict nested schemas."""
        require_fields(data, _BUNDLE_FIELDS)
        values = dict(data)
        values["extractor"] = ExtractorIdentity.from_dict(values["extractor"])
        values["measurements"] = AnalysisMeasurements.from_dict(values["measurements"])
        return cls(**values)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible feature artifact metadata."""
        return {
            "feature_id": self.feature_id,
            "asset_id": self.asset_id,
            "config_id": self.config_id,
            "extractor": self.extractor.to_dict(),
            "measurements": self.measurements.to_dict(),
            "schema_version": self.schema_version,
        }
