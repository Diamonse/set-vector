"""Canonical identities and atomic, validated local feature artifacts."""

import json
import os
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

import setvector.storage.artifacts as artifacts_module
from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisMeasurements,
    ArtifactError,
    AudioAsset,
    BeatPosition,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
)
from setvector.storage import ArtifactStore, canonical_json, compute_feature_id, strict_json_loads

TIMING = ((0.25, 0.5, 0.75), (0.0, 0.25, 0.5), (0.5, 0.75, 1.0))


def series(name, unit, values):
    return FeatureSeries(
        name=name,
        unit=unit,
        timestamps=TIMING[0],
        values=values,
        validity=tuple(value is not None for value in values),
        window_starts=TIMING[1],
        window_ends=TIMING[2],
    )


@pytest.fixture
def asset(tmp_path):
    return AudioAsset(
        asset_id="a" * 64,
        observed_path=str((tmp_path / "music" / "track.wav").resolve()),
        byte_size=1_044,
        duration_seconds=1.0,
        native_sample_rate=8_000,
        channels=2,
        format="WAV",
        subtype="PCM_16",
    )


@pytest.fixture
def identity():
    return ExtractorIdentity(
        name="baseline-v1",
        algorithm_version=1,
        package_version="0.1.0a1",
        config=AnalysisConfig(
            sample_rate=None, frame_length=4_000, hop_length=2_000, channel_policy="mono"
        ),
        parameters={"bass_cutoff_hz": 250.0, "spectral_window": "hann"},
        dependency_versions={"numpy": "2.4.6", "librosa": "0.11.0"},
    )


@pytest.fixture
def bundle(asset, identity):
    measurements = AnalysisMeasurements(
        rms=series("rms", "linear_amplitude", (0.0, 0.1, 0.30000000000000004)),
        spectral_centroid=series("spectral_centroid", "Hz", (None, 440.0, 441.5)),
        bass_power_ratio=series("bass_power_ratio", "ratio", (None, 0.2, 0.25)),
        onset_strength=series("onset_strength", "normalized_flux", (0.0, 1.0, 0.1)),
        tempo_bpm=120.0,
        beats=(BeatPosition(frame_index=1, seconds=0.5),),
        diagnostics=AnalysisDiagnostics(
            analyzed_frames=3, omitted_tail_samples=7, warnings=("ünïcode warning",)
        ),
    )
    return FeatureBundle(
        feature_id=compute_feature_id(asset.asset_id, identity),
        asset_id=asset.asset_id,
        config_id=identity.config.config_id,
        extractor=identity,
        measurements=measurements,
    )


def test_canonical_json_is_sorted_compact_utf8():
    assert canonical_json({"b": 1, "a": "é"}) == '{"a":"é","b":1}'.encode()
    with pytest.raises(ValueError):
        canonical_json({"a": float("nan")})


def test_strict_json_loads_rejects_duplicate_keys():
    with pytest.raises(ValueError, match="duplicate field: a"):
        strict_json_loads('{"a": 1, "a": 2}')


def test_feature_id_excludes_observed_path(asset, identity):
    first = compute_feature_id(asset.asset_id, identity)
    moved_path = (Path(asset.observed_path).parent / "moved" / "track.wav").resolve()
    moved = AudioAsset.from_dict({**asset.to_dict(), "observed_path": str(moved_path)})
    assert compute_feature_id(moved.asset_id, identity) == first


def test_feature_id_changes_with_identity_inputs(asset, identity):
    first = compute_feature_id(asset.asset_id, identity)
    assert compute_feature_id("b" * 64, identity) != first
    new_numpy = replace(identity, dependency_versions={"numpy": "2.5.0", "librosa": "0.11.0"})
    assert compute_feature_id(asset.asset_id, new_numpy) != first
    new_config = replace(identity, config=replace(identity.config, hop_length=1_000))
    assert compute_feature_id(asset.asset_id, new_config) != first


def test_store_round_trip_uses_json_and_non_pickle_npz(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path / "workspace")
    manifest = store.save(asset, bundle)
    assert manifest == store.manifest_path(bundle.feature_id)
    assert manifest.is_absolute()
    assert store.load(bundle.feature_id, asset) == bundle
    with np.load(manifest.parent / "arrays.npz", allow_pickle=False) as arrays:
        assert arrays["spectral_centroid__validity"].dtype == np.bool_
        assert arrays["spectral_centroid__values"].dtype.kind == "f"
    assert (tmp_path / "workspace" / "assets" / asset.asset_id / "asset.json").is_file()


def test_validity_mask_reconstructs_missing_values(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    loaded = store.load(bundle.feature_id, asset)
    assert loaded.measurements.spectral_centroid.values == (None, 440.0, 441.5)
    assert loaded.measurements.rms.values[0] == 0.0


def test_relative_workspace_resolves_to_absolute(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert ArtifactStore("relative space").workspace == (tmp_path / "relative space").resolve()


def test_absent_feature_returns_none(tmp_path, asset):
    assert ArtifactStore(tmp_path).load("f" * 64, asset) is None


def test_save_is_idempotent_and_keeps_existing_asset_path(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    first = store.save(asset, bundle)
    moved = replace(asset, observed_path=str((tmp_path / "elsewhere.wav").resolve()))
    assert store.save(moved, bundle) == first
    assert store.load(bundle.feature_id, moved) == bundle


def test_partial_feature_directory_is_an_error(tmp_path, asset):
    store = ArtifactStore(tmp_path)
    target = store.manifest_path("f" * 64).parent
    target.mkdir(parents=True)
    (target / "manifest.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ArtifactError, match="incomplete"):
        store.load("f" * 64, asset)


def test_corrupt_completed_artifact_is_not_overwritten(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    store.manifest_path(bundle.feature_id).write_text("{broken", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        store.save(asset, bundle)
    assert store.manifest_path(bundle.feature_id).read_text(encoding="utf-8") == "{broken"


def rewrite_manifest(store, bundle, edit):
    path = store.manifest_path(bundle.feature_id)
    data = json.loads(path.read_text(encoding="utf-8"))
    edit(data)
    path.write_text(json.dumps(data), encoding="utf-8")


@pytest.mark.parametrize(
    "edit",
    [
        lambda data: data.update(schema_version=2),
        lambda data: data.update(extra=True),
        lambda data: data.update(feature_id="e" * 64),
        lambda data: data["extractor"].update(package_version="9.9.9"),
        lambda data: data["series"]["rms"]["arrays"].update(values="other__values"),
    ],
    ids=["schema", "unknown-field", "manifest-id", "identity-drift", "array-key"],
)
def test_manifest_inconsistencies_are_rejected(tmp_path, asset, bundle, edit):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    rewrite_manifest(store, bundle, edit)
    with pytest.raises(ArtifactError, match="corrupt or incompatible"):
        store.load(bundle.feature_id, asset)


def test_duplicate_manifest_keys_are_rejected(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    path = store.manifest_path(bundle.feature_id)
    text = path.read_text(encoding="utf-8")
    path.write_text(text.replace("{", '{"asset_id": "x", ', 1), encoding="utf-8")
    with pytest.raises(ArtifactError, match="duplicate"):
        store.load(bundle.feature_id, asset)


def test_missing_or_pickled_arrays_are_rejected(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    arrays_path = store.manifest_path(bundle.feature_id).parent / "arrays.npz"
    with np.load(arrays_path, allow_pickle=False) as arrays:
        kept = {key: arrays[key] for key in arrays.files if key != "rms__values"}
    with arrays_path.open("wb") as stream:
        np.savez(stream, **kept)
    with pytest.raises(ArtifactError, match="arrays"):
        store.load(bundle.feature_id, asset)
    with arrays_path.open("wb") as stream:
        np.savez(stream, **kept, rms__values=np.array([object(), 1, 2], dtype=object))
    with pytest.raises(ArtifactError, match="corrupt"):
        store.load(bundle.feature_id, asset)


def test_save_rejects_bundle_identity_mismatches(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    with pytest.raises(ArtifactError, match="asset_id"):
        store.save(asset, replace(bundle, asset_id="b" * 64))
    with pytest.raises(ArtifactError, match="feature_id"):
        store.save(asset, replace(bundle, feature_id="f" * 64))
    assert not (tmp_path / "features").exists()


def test_existing_artifact_with_different_contents_is_an_error(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    changed = replace(bundle, measurements=replace(bundle.measurements, tempo_bpm=121.0))
    with pytest.raises(ArtifactError, match="differs"):
        store.save(asset, changed)


def test_feature_cache_requires_valid_asset_artifact(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    asset_path = tmp_path / "assets" / asset.asset_id / "asset.json"
    asset_path.unlink()
    with pytest.raises(ArtifactError, match="asset"):
        store.load(bundle.feature_id, asset)


@pytest.mark.parametrize(
    "content",
    ["{broken", '{"schema_version": 2}', None],
    ids=["corrupt", "incompatible", "content-mismatch"],
)
def test_invalid_asset_json_rejects_cache_hit(tmp_path, asset, bundle, content):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    asset_path = tmp_path / "assets" / asset.asset_id / "asset.json"
    if content is None:
        content = json.dumps({**asset.to_dict(), "byte_size": asset.byte_size + 1})
    asset_path.write_text(content, encoding="utf-8")
    with pytest.raises(ArtifactError, match="asset"):
        store.load(bundle.feature_id, asset)


def test_load_rejects_asset_that_differs_from_bundle(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    other = replace(asset, asset_id="b" * 64)
    with pytest.raises(ArtifactError, match="asset_id"):
        store.load(bundle.feature_id, other)


def test_failed_rename_leaves_no_published_or_temporary_feature(
    monkeypatch, tmp_path, asset, bundle
):
    store = ArtifactStore(tmp_path)
    real_replace = os.replace

    def failing_replace(source, target):
        if Path(target).parent.name == "features":
            raise OSError("simulated rename failure")
        return real_replace(source, target)

    monkeypatch.setattr(artifacts_module.os, "replace", failing_replace)
    with pytest.raises(ArtifactError, match="publish"):
        store.save(asset, bundle)
    assert not store.manifest_path(bundle.feature_id).parent.exists()
    assert list((tmp_path / "features").iterdir()) == []
    assert store.load(bundle.feature_id, asset) is None


def test_concurrent_publication_of_same_bundle_is_accepted(monkeypatch, tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    other_writer = ArtifactStore(tmp_path)
    real_replace = os.replace

    def racing_replace(source, target):
        if Path(target).parent.name == "features":
            monkeypatch.setattr(artifacts_module.os, "replace", real_replace)
            other_writer.save(asset, bundle)
            raise PermissionError("target exists")
        return real_replace(source, target)

    monkeypatch.setattr(artifacts_module.os, "replace", racing_replace)
    assert store.save(asset, bundle) == store.manifest_path(bundle.feature_id)
    assert store.load(bundle.feature_id, asset) == bundle
    leftovers = [p.name for p in (tmp_path / "features").iterdir()]
    assert leftovers == [bundle.feature_id]


def test_empty_series_round_trip(tmp_path, asset, identity):
    empty = FeatureSeries(
        name="rms",
        unit="linear_amplitude",
        timestamps=(),
        values=(),
        validity=(),
        window_starts=(),
        window_ends=(),
    )
    measurements = AnalysisMeasurements(
        rms=empty,
        spectral_centroid=replace(empty, name="spectral_centroid", unit="Hz"),
        bass_power_ratio=replace(empty, name="bass_power_ratio", unit="ratio"),
        onset_strength=replace(empty, name="onset_strength", unit="normalized_flux"),
        tempo_bpm=None,
        beats=(),
        diagnostics=AnalysisDiagnostics(
            analyzed_frames=0, omitted_tail_samples=5, warnings=("too short",)
        ),
    )
    short = FeatureBundle(
        feature_id=compute_feature_id(asset.asset_id, identity),
        asset_id=asset.asset_id,
        config_id=identity.config.config_id,
        extractor=identity,
        measurements=measurements,
    )
    store = ArtifactStore(tmp_path)
    store.save(asset, short)
    assert store.load(short.feature_id, asset) == short
