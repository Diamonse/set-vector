"""Tests for extractor identity, including missing-dependency reporting."""

from importlib.metadata import PackageNotFoundError

import pytest

import setvector.analysis.identity as identity_module
from setvector.analysis import baseline_identity, rhythm_identity
from setvector.domain import AnalysisConfig, InstallationError


def test_rhythm_identity_reports_missing_dependency_as_installation_error(monkeypatch):
    config = AnalysisConfig(
        sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono"
    )
    baseline = baseline_identity(config)
    real_version = identity_module.version

    def fake_version(name: str) -> str:
        if name == "torch":
            raise PackageNotFoundError(name)
        return real_version(name)

    monkeypatch.setattr(identity_module, "version", fake_version)
    with pytest.raises(InstallationError, match="torch"):
        rhythm_identity(baseline)
