"""Report pages are self-contained, escaped, and bounded in size."""

import base64
import json
import re

import pytest

from setvector.ingestion import PreviewAudio
from setvector.visualization import build_report_model, render_report_html
from setvector.visualization.html import json_for_script, raw_text

EXTERNAL = [
    re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?\s*(?:https?:)?//""", re.I),
    re.compile(r"@import", re.I),
]


def script_content(page, element_id):
    match = re.search(rf'<script id="{element_id}"[^>]*>(.*?)</script>', page, re.S)
    assert match, element_id
    return match.group(1)


@pytest.fixture
def page(report_inputs):
    asset, bundle = report_inputs(frames=8, missing=(3,))
    return render_report_html(build_report_model(asset, bundle)), bundle


def test_page_is_self_contained(page):
    html, _ = page
    for pattern in EXTERNAL:
        assert not pattern.search(html), pattern.pattern
    assert "data:font/woff2;base64," in html
    assert "var uPlot=function()" in html
    assert not re.search(r"\{\{[A-Z_]+\}\}", html)


def test_model_json_is_embedded_intact(page, report_inputs):
    html, bundle = page
    asset, same_bundle = report_inputs(frames=8, missing=(3,))
    expected = json.loads(json.dumps(build_report_model(asset, same_bundle).to_dict()))
    assert json.loads(script_content(html, "sv-model")) == expected
    assert bundle.feature_id in html


def test_audio_is_embedded_only_when_given(report_inputs):
    asset, bundle = report_inputs()
    model = build_report_model(asset, bundle)
    silent = render_report_html(model)
    assert script_content(silent, "sv-audio") == ""
    audio = PreviewAudio("audio/mpeg", b"\xff\xfb\x90\x00fake mp3")
    loud = render_report_html(model, audio)
    assert base64.b64decode(script_content(loud, "sv-audio")) == audio.data
    assert 'data-mime="audio/mpeg"' in loud


def test_title_text_is_escaped(report_inputs):
    asset, bundle = report_inputs(name='DJ <i> - <b>Tune & "Co".wav')
    html = render_report_html(build_report_model(asset, bundle))
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    assert title == "&lt;b&gt;Tune &amp; &quot;Co&quot; · SetVector report"
    model_json = script_content(html, "sv-model")
    assert "<" not in model_json and "&" not in model_json
    assert json.loads(model_json)["artist"] == "DJ <i>"


def test_script_json_cannot_close_its_element():
    hostile = "</script><!-- &   "
    text = json_for_script({"title": hostile})
    assert not any(c in text for c in "<>&  ")
    assert json.loads(text) == {"title": hostile}


@pytest.mark.parametrize("element", ["script", "style"])
def test_raw_text_rejects_closing_tags(element):
    with pytest.raises(ValueError, match=element):
        raw_text(f"a</{element.upper()}>b", element)


def test_six_minute_report_without_audio_is_small(report_inputs):
    asset, bundle = report_inputs(frames=31_004, beat_frames=range(0, 31_004, 41))
    html = render_report_html(build_report_model(asset, bundle))
    assert len(html.encode("utf-8")) < 2_000_000
