"""Tools for reproducible track analysis and energy modeling."""

from importlib.metadata import version

from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisError,
    AnalysisMeasurements,
    ArtifactError,
    AudioAsset,
    BeatPosition,
    CandidateQuality,
    DecodeError,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
    GridSegment,
    InputError,
    InstallationError,
    JsonScalar,
    RhythmAnalysis,
    SetVectorError,
    UnsupportedAudioError,
)

__version__ = version("setvector")

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
    "__version__",
]
