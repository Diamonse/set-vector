"""Tools for reproducible track analysis and energy modeling."""

from importlib.metadata import version

from setvector.domain import AnalysisConfig, FeatureSeries

__version__ = version("setvector")

__all__ = ["AnalysisConfig", "FeatureSeries", "__version__"]
