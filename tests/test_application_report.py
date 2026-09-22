"""Report generation reuses stored features and verifies embedded audio."""

import base64
import re
import shutil

import pytest

from setvector.application import ReportOutcome, analyze_track, render_report
from setvector.domain import InputError
from setvector.storage import ArtifactStore


def unexpected(*args, **kwargs):
    raise AssertionError("report generation must not reanalyze audio")


@pytest.fixture
def analyzed(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    return store, analyze_track(tone_path, config, store)


def embedded_audio(path):
    html = path.read_text(encoding="utf-8")
    match = re.search(r'<script id="sv-audio"[^>]*>(.*?)</script>', html, re.S)
    return base64.b64decode(match.group(1))


def test_default_report_embeds_verified_audio(monkeypatch, analyzed):
    store, outcome = analyzed
    monkeypatch.setattr("setvector.application.analyze.decode_audio", unexpected)
    monkeypatch.setattr("setvector.application.analyze.extract_baseline", unexpected)
    result = render_report(outcome.features.feature_id, store)
    assert isinstance(result, ReportOutcome)
    assert result.report_path == store.workspace / "reports" / f"{outcome.features.feature_id}.html"
    assert result.audio_embedded
    assert embedded_audio(result.report_path)[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xe3", b"ID")


def test_no_audio_and_custom_output(tmp_path, analyzed):
    store, outcome = analyzed
    result = render_report(
        outcome.features.feature_id, store, output=tmp_path / "out" / "r.html", include_audio=False
    )
    assert result.report_path == (tmp_path / "out" / "r.html").resolve()
    assert not result.audio_embedded
    assert embedded_audio(result.report_path) == b""


def test_moved_audio_needs_an_explicit_path(tmp_path, analyzed, tone_path):
    store, outcome = analyzed
    moved = tmp_path / "moved.wav"
    shutil.move(tone_path, moved)
    with pytest.raises(InputError, match="--no-audio"):
        render_report(outcome.features.feature_id, store)
    assert render_report(outcome.features.feature_id, store, audio=moved).audio_embedded


def test_different_audio_is_refused(tmp_path, analyzed, click_tone_writer):
    store, outcome = analyzed
    other = click_tone_writer(tmp_path / "other.wav", tone_hz=330.0)
    with pytest.raises(InputError, match="not the audio that was analyzed"):
        render_report(outcome.features.feature_id, store, audio=other)


def test_existing_report_requires_overwrite(analyzed):
    store, outcome = analyzed
    feature_id = outcome.features.feature_id
    first = render_report(feature_id, store, include_audio=False)
    with pytest.raises(InputError, match="--overwrite"):
        render_report(feature_id, store, include_audio=False)
    assert render_report(feature_id, store, include_audio=False, overwrite=True) == first


def test_audio_path_and_no_audio_conflict(analyzed, tone_path):
    store, outcome = analyzed
    with pytest.raises(InputError, match="either"):
        render_report(outcome.features.feature_id, store, audio=tone_path, include_audio=False)


def test_unknown_feature_is_an_input_error(tmp_path):
    with pytest.raises(InputError, match="no feature artifact"):
        render_report("f" * 64, ArtifactStore(tmp_path))
