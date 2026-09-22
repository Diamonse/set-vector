"""Assemble one self-contained report page from the model, packaged assets, and audio."""

import base64
import html
import json
import re
from importlib.resources import files

from setvector.ingestion import PreviewAudio

from .model import ReportModel

_ASSETS = files("setvector.visualization").joinpath("assets")
_PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")
_FONTS = (
    (
        "inter-latin-wght-normal.woff2",
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,"
        "U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    ),
    (
        "inter-latin-ext-wght-normal.woff2",
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,"
        "U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,"
        "U+2C60-2C7F,U+A720-A7FF",
    ),
)


def _asset_text(name: str) -> str:
    return _ASSETS.joinpath(name).read_text(encoding="utf-8")


def _asset_base64(name: str) -> str:
    return base64.b64encode(_ASSETS.joinpath(name).read_bytes()).decode("ascii")


def raw_text(content: str, element: str) -> str:
    """Return content for a ``<script>`` or ``<style>`` element, refusing early closure."""
    if f"</{element}" in content.lower():
        raise ValueError(f"content would close its <{element}> element")
    return content


def json_for_script(value: object) -> str:
    """Serialize JSON that is inert inside an HTML ``<script>`` element."""
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return (
        text.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
    )


def _font_css() -> str:
    return "".join(
        '@font-face{font-family:"SetVector Inter";font-style:normal;font-display:swap;'
        f"font-weight:100 900;src:url(data:font/woff2;base64,{_asset_base64(name)}) "
        f'format("woff2");unicode-range:{ranges}}}'
        for name, ranges in _FONTS
    )


def render_report_html(model: ReportModel, audio: PreviewAudio | None = None) -> str:
    """Return the complete report page; it references nothing outside itself."""
    values = {
        "TITLE": html.escape(f"{model.title} · SetVector report"),
        "FONT_CSS": _font_css(),
        "UPLOT_CSS": raw_text(_asset_text("uPlot.min.css"), "style"),
        "REPORT_CSS": raw_text(_asset_text("report.css"), "style"),
        "MODEL_JSON": json_for_script(model.to_dict()),
        "AUDIO_TYPE": html.escape(audio.mime_type if audio else "", quote=True),
        "AUDIO_DATA": base64.b64encode(audio.data).decode("ascii") if audio else "",
        "UPLOT_JS": raw_text(_asset_text("uPlot.iife.min.js"), "script"),
        "REPORT_JS": raw_text(_asset_text("report.js"), "script"),
    }
    return _PLACEHOLDER.sub(lambda match: values[match.group(1)], _asset_text("report.html"))
