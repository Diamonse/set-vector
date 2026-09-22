"""Numerical feature extraction without filesystem access."""

from .baseline import extract_baseline
from .identity import baseline_identity

__all__ = ["baseline_identity", "extract_baseline"]
