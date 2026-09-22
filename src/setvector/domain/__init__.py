"""Validated, immutable data shared by SetVector's analysis workflows."""

from .audio import AudioAsset
from .bundle import (
    AnalysisDiagnostics,
    AnalysisMeasurements,
    BeatPosition,
    ExtractorIdentity,
    FeatureBundle,
    JsonScalar,
)
from .config import AnalysisConfig
from .errors import (
    AnalysisError,
    ArtifactError,
    DecodeError,
    InputError,
    SetVectorError,
    UnsupportedAudioError,
)
from .features import FeatureSeries

__all__ = [
    "AnalysisConfig",
    "AnalysisDiagnostics",
    "AnalysisError",
    "AnalysisMeasurements",
    "ArtifactError",
    "AudioAsset",
    "BeatPosition",
    "DecodeError",
    "ExtractorIdentity",
    "FeatureBundle",
    "FeatureSeries",
    "InputError",
    "JsonScalar",
    "SetVectorError",
    "UnsupportedAudioError",
]
