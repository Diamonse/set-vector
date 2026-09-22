"""Cache-first orchestration of inspection, decoding, extraction, and storage."""

from dataclasses import FrozenInstanceError, replace

import pytest

from setvector.application import AnalysisOutcome, analyze_track
from setvector.domain import ArtifactError
from setvector.storage import ArtifactStore


def unexpected_call(*args, **kwargs):
    raise AssertionError("a cache hit must not decode or extract audio")


def test_analyze_track_writes_then_reuses_feature_artifact(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    first = analyze_track(tone_path, config, store)
    second = analyze_track(tone_path, config, store)
    assert isinstance(first, AnalysisOutcome)
    assert not first.cache_hit
    assert second.cache_hit
    assert second.features == first.features
    assert second.manifest_path == first.manifest_path
    assert first.manifest_path.is_absolute() and first.manifest_path.is_file()
    assert first.asset.asset_id == first.features.asset_id
    assert first.features.config_id == config.config_id
    with pytest.raises(FrozenInstanceError):
        first.cache_hit = True


def test_cache_hit_does_not_decode_or_extract(monkeypatch, tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    analyze_track(tone_path, config, store)
    monkeypatch.setattr("setvector.application.analyze.decode_audio", unexpected_call)
    monkeypatch.setattr("setvector.application.analyze.extract_baseline", unexpected_call)
    assert analyze_track(tone_path, config, store).cache_hit


def test_moved_file_reuses_features(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    first = analyze_track(tone_path, config, store)
    moved = tmp_path / "moved.wav"
    moved.write_bytes(tone_path.read_bytes())
    second = analyze_track(moved, config, store)
    assert second.cache_hit
    assert second.features.feature_id == first.features.feature_id
    assert second.asset.observed_path == str(moved.resolve())


def test_changed_audio_or_config_creates_new_features(
    tmp_path, tone_path, config, click_tone_writer
):
    store = ArtifactStore(tmp_path / "workspace")
    original = analyze_track(tone_path, config, store)
    other_audio = click_tone_writer(tmp_path / "other.wav", tone_hz=330.0)
    changed_audio = analyze_track(other_audio, config, store)
    changed_config = analyze_track(tone_path, replace(config, hop_length=128), store)
    ids = {
        original.features.feature_id,
        changed_audio.features.feature_id,
        changed_config.features.feature_id,
    }
    assert len(ids) == 3
    assert not changed_audio.cache_hit and not changed_config.cache_hit


def test_corrupt_existing_artifact_is_not_recomputed(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    outcome = analyze_track(tone_path, config, store)
    outcome.manifest_path.write_text("{broken", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        analyze_track(tone_path, config, store)
    assert outcome.manifest_path.read_text(encoding="utf-8") == "{broken"
