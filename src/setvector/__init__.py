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
    DecodeError,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
    InputError,
    JsonScalar,
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
    "DecodeError",
    "ExtractorIdentity",
    "FeatureBundle",
    "FeatureSeries",
    "InputError",
    "JsonScalar",
    "SetVectorError",
    "UnsupportedAudioError",
    "__version__",
]
