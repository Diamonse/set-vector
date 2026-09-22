"""Immutable feature-bundle contract boundaries."""

from dataclasses import replace

import pytest

from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisMeasurements,
    BeatPosition,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
)


@pytest.fixture
def config():
    return AnalysisConfig(
        sample_rate=8_000,
        frame_length=4,
        hop_length=2,
        channel_policy="mono",
    )


@pytest.fixture
def measurements():
    def series(name, unit, values):
        return FeatureSeries(
            name=name,
            unit=unit,
            timestamps=(0.00025, 0.0005),
            values=values,
            validity=(True, True),
            window_starts=(0.0, 0.00025),
            window_ends=(0.0005, 0.00075),
        )

    return AnalysisMeasurements(
        rms=series("rms", "linear_amplitude", (0.0, 0.5)),
        spectral_centroid=series("spectral_centroid", "Hz", (0.0, 10.0)),
        bass_power_ratio=series("bass_power_ratio", "ratio", (0.0, 0.5)),
        onset_strength=series("onset_strength", "normalized_flux", (0.0, 0.2)),
        tempo_bpm=120.0,
        beats=(BeatPosition(frame_index=1, seconds=0.0005),),
        diagnostics=AnalysisDiagnostics(analyzed_frames=2, omitted_tail_samples=1, warnings=[]),
    )


@pytest.fixture
def identity(config):
    return ExtractorIdentity(
        name="baseline-v1",
        algorithm_version=1,
        package_version="0.1.0a1",
        config=config,
        parameters={"bass_cutoff_hz": 250.0, "spectral_window": "hann"},
        dependency_versions={"numpy": "2.4.6"},
    )


def test_extractor_identity_copies_mutable_inputs(config):
    parameters = {"bass_cutoff_hz": 250.0, "spectral_window": "hann"}
    dependencies = {"numpy": "2.4.6"}
    identity = ExtractorIdentity(
        name="baseline-v1",
        algorithm_version=1,
        package_version="0.1.0a1",
        config=config,
        parameters=parameters,
        dependency_versions=dependencies,
    )

    parameters["bass_cutoff_hz"] = 80.0

    assert identity.to_dict()["parameters"]["bass_cutoff_hz"] == 250.0
    with pytest.raises(TypeError):
        identity.parameters["new"] = "value"


def test_extractor_identity_preserves_integer_json_scalars(config):
    identity = ExtractorIdentity(
        name="baseline-v1",
        algorithm_version=1,
        package_version="0.1.0a1",
        config=config,
        parameters={"algorithm_seed": 3},
        dependency_versions={"numpy": "2.4.6"},
    )

    assert type(identity.to_dict()["parameters"]["algorithm_seed"]) is int


def test_feature_bundle_rejects_mismatched_config_id(config, measurements, identity):
    with pytest.raises(ValueError, match="config_id"):
        FeatureBundle(
            feature_id="f" * 64,
            asset_id="a" * 64,
            config_id="0" * 64,
            extractor=identity,
            measurements=measurements,
        )


def test_measurements_reject_mislabeled_or_incoherent_series(measurements):
    mislabeled = replace(measurements.rms, name="loudness")
    with pytest.raises(ValueError, match="rms.*linear_amplitude"):
        replace(measurements, rms=mislabeled)
    with pytest.raises(ValueError, match="analyzed_frames"):
        replace(
            measurements,
            diagnostics=replace(measurements.diagnostics, analyzed_frames=999),
        )


def test_measurements_require_aligned_series_and_consistent_beats(measurements):
    shifted = replace(measurements.onset_strength, timestamps=(0.0003, 0.0005))
    with pytest.raises(ValueError, match="timing"):
        replace(measurements, onset_strength=shifted)
    with pytest.raises(ValueError, match="beats"):
        replace(measurements, beats=(BeatPosition(frame_index=0, seconds=0.0005),))


def test_measurements_clear_tempo_when_no_beats(measurements):
    result = replace(measurements, tempo_bpm=120.0, beats=())

    assert result.tempo_bpm is None


def test_bundle_and_nested_contracts_round_trip(identity, measurements):
    bundle = FeatureBundle(
        feature_id="f" * 64,
        asset_id="a" * 64,
        config_id=identity.config.config_id,
        extractor=identity,
        measurements=measurements,
    )

    assert FeatureBundle.from_dict(bundle.to_dict()) == bundle
    with pytest.raises(ValueError, match="unknown fields"):
        FeatureBundle.from_dict({**bundle.to_dict(), "extra": True})
