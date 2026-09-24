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
    InstallationError,
    SetVectorError,
    UnsupportedAudioError,
)
from .features import FeatureSeries
from .rhythm import CandidateQuality, GridSegment, RhythmAnalysis

__all__ = [
    "AnalysisConfig",
    "AnalysisDiagnostics",
    "AnalysisError",
    "AnalysisMeasurements",
    "ArtifactError",
    "AudioAsset",
    "BeatPosition",
    "CandidateQuality",
    "DecodeError",
    "ExtractorIdentity",
    "FeatureBundle",
    "FeatureSeries",
    "GridSegment",
    "InputError",
    "InstallationError",
    "JsonScalar",
    "RhythmAnalysis",
    "SetVectorError",
    "UnsupportedAudioError",
]
