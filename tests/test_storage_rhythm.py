"""Atomic, verified rhythm artifacts."""

import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

import setvector.storage.publish as publish_module
from setvector.domain import ArtifactError
from setvector.storage import RhythmStore


@pytest.fixture
def rhythm(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    return rhythm_factory(bundle)


def test_save_then_load_round_trips(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    assert path == tmp_path.resolve() / "rhythm" / rhythm.rhythm_id / "rhythm.json"
    assert store.path(rhythm.rhythm_id) == path
    assert store.load(rhythm.rhythm_id) == rhythm


def test_missing_rhythm_loads_as_none(tmp_path, rhythm):
    assert RhythmStore(tmp_path).load(rhythm.rhythm_id) is None


def test_saving_identical_rhythm_twice_is_accepted(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    assert store.save(rhythm) == store.save(rhythm)


def test_conflicting_existing_rhythm_is_an_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["reasons"] = ["tampered"]
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ArtifactError, match="differs"):
        store.save(rhythm)


def test_corrupt_rhythm_is_an_artifact_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    store.save(rhythm).write_text("{not json", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        store.load(rhythm.rhythm_id)


def test_rhythm_in_the_wrong_directory_is_an_artifact_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    moved = path.parent.parent / ("c" * 64)
    path.parent.rename(moved)
    with pytest.raises(ArtifactError, match="directory"):
        store.load("c" * 64)


def test_save_rejects_a_rhythm_whose_id_does_not_match(tmp_path, rhythm):
    with pytest.raises(ArtifactError, match="rhythm_id"):
        RhythmStore(tmp_path).save(replace(rhythm, rhythm_id="d" * 64))


def test_concurrent_publication_of_same_rhythm_is_accepted(monkeypatch, tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    other_writer = RhythmStore(tmp_path)
    real_replace = os.replace

    def racing_replace(source, target):
        if Path(target).parent.name == "rhythm":
            monkeypatch.setattr(publish_module.os, "replace", real_replace)
            other_writer.save(rhythm)
            raise PermissionError("target exists")
        return real_replace(source, target)

    monkeypatch.setattr(publish_module.os, "replace", racing_replace)
    assert store.save(rhythm) == store.path(rhythm.rhythm_id)
    assert store.load(rhythm.rhythm_id) == rhythm
    leftovers = [p.name for p in (tmp_path / "rhythm").iterdir()]
    assert leftovers == [rhythm.rhythm_id]


def test_failed_rename_leaves_nothing_published(monkeypatch, tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    real_replace = os.replace

    def failing_replace(source, target):
        if Path(target).parent.name == "rhythm":
            raise OSError("simulated rename failure")
        return real_replace(source, target)

    monkeypatch.setattr(publish_module.os, "replace", failing_replace)
    with pytest.raises(ArtifactError, match="publish"):
        store.save(rhythm)
    assert list((tmp_path / "rhythm").iterdir()) == []
    assert store.load(rhythm.rhythm_id) is None
