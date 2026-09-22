"""Validated, immutable data shared by SetVector's analysis workflows."""

from .config import AnalysisConfig
from .features import FeatureSeries

__all__ = ["AnalysisConfig", "FeatureSeries"]
