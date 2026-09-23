"""Build a navigable collection from existing SetVector HTML reports."""

import html
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from setvector.domain import ArtifactError, InputError
from setvector.storage import write_report

_MODEL = re.compile(r'<script id="sv-model" type="application/json">(.*?)</script>', re.S)
_GENERATOR = '<meta name="generator" content="SetVector">'
_THEME_CONTROL = '<div class="seg" id="theme"'
_NAV_MARKER = 'data-setvector-index-nav="1"'
_LEGACY_NAV_MARKER = 'id="back-to-list"'
_NAV_STYLE = """<style id="setvector-index-nav-style">
.back-to-list { color: var(--text); text-decoration: none; background: var(--panel);
  border: 1px solid var(--line); border-radius: 999px; padding: 7px 12px;
  font-size: 13px; font-weight: 600; }
.back-to-list:hover, .back-to-list:focus-visible { background: var(--panel-2);
  border-color: var(--level); outline-offset: 3px; }
</style>
"""
_NAV_LINK = (
    '<a class="back-to-list" data-setvector-index-nav="1" href="../index.html">'
    '← Back to song list</a>\n    '
)


@dataclass(frozen=True, slots=True)
class ReportIndexOutcome:
    """Location and size of a generated report collection."""

    index_path: Path
    report_count: int
    linked_count: int


@dataclass(frozen=True, slots=True)
class _ReportEntry:
    path: Path
    title: str
    artist: str | None
    duration_seconds: float
    tempo_bpm: float | None
    warning_count: int


def _read_entry(path: Path) -> tuple[_ReportEntry, str]:
    try:
        page = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ArtifactError(f"cannot read report {path}: {error}") from error
    match = _MODEL.search(page)
    if _GENERATOR not in page or match is None:
        raise InputError(f"not a SetVector report: {path}")
    try:
        model = json.loads(match.group(1))
        title = model["title"]
        artist = model["artist"]
        duration = model["duration_seconds"]
        tempo = model["tempo_bpm"]
        warnings = model["warnings"]
        if (
            not isinstance(title, str)
            or not title
            or (artist is not None and not isinstance(artist, str))
            or type(duration) not in (int, float)
            or not math.isfinite(duration)
            or duration < 0
            or (tempo is not None and (type(tempo) not in (int, float) or not math.isfinite(tempo)))
            or not isinstance(warnings, list)
        ):
            raise ValueError("invalid report summary")
    except (KeyError, TypeError, ValueError) as error:
        raise InputError(f"invalid SetVector report metadata in {path}: {error}") from error
    return _ReportEntry(path, title, artist, duration, tempo, len(warnings)), page


def _add_back_link(page: str, path: Path) -> str:
    if _NAV_MARKER in page or _LEGACY_NAV_MARKER in page:
        return page
    if page.count("</head>") != 1 or page.count(_THEME_CONTROL) != 1:
        raise InputError(f"unexpected SetVector report layout: {path}")
    return page.replace("</head>", _NAV_STYLE + "</head>", 1).replace(
        _THEME_CONTROL, _NAV_LINK + _THEME_CONTROL, 1
    )


def _index_html(entries: list[_ReportEntry]) -> str:
    rows = []
    for entry in entries:
        name = f"{entry.artist} - {entry.title}" if entry.artist else entry.title
        duration = int(round(entry.duration_seconds))
        minutes, seconds = divmod(duration, 60)
        bpm = "—" if entry.tempo_bpm is None else f"{entry.tempo_bpm:.1f}"
        target = "reports/" + quote(entry.path.name, safe="")
        rows.append(
            "<tr><td>"
            + html.escape(name)
            + f"</td><td>{minutes}:{seconds:02d}</td><td>{bpm}</td>"
            + f"<td>{entry.warning_count}</td><td>"
            + f'<a href="{html.escape(target, quote=True)}">Open report</a></td></tr>'
        )
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>SetVector report list</title>"
        "<style>:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#11151a;"
        "color:#edf3f7}body{max-width:1100px;margin:auto;padding:32px 20px}"
        "input{width:min(100%,480px);padding:10px;margin:12px 0 20px;background:#1b242c;"
        "color:inherit;border:1px solid #567281;border-radius:8px}"
        "table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;"
        "border-bottom:1px solid #2e3a42}a{color:#64d9cf}"
        "tr[hidden]{display:none}</style><body><main>"
        f"<h1>Track reports</h1><p>{len(entries)} reports. Tempo values are estimates.</p>"
        '<label for="search">Find a track</label><br>'
        '<input id="search" type="search" placeholder="Search artist or song">'
        "<table><thead><tr><th>Song</th><th>Length</th><th>BPM</th>"
        "<th>Warnings</th><th>Report</th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table></main><script>"
        "const search=document.querySelector('#search');"
        "search.addEventListener('input',()=>{const q=search.value.toLocaleLowerCase();"
        "for(const row of document.querySelectorAll('tbody tr'))"
        "row.hidden=!row.cells[0].textContent.toLocaleLowerCase().includes(q)});"
        "</script></body></html>"
    )


def create_report_index(collection: str | Path, *, overwrite: bool = False) -> ReportIndexOutcome:
    """Index ``collection/reports/*.html`` and link each report back to the index.

    Only generated report files are edited. All inputs are validated before any file is
    changed, and the index is published before links to it are added.
    """
    root = Path(collection).resolve()
    reports_dir = root / "reports"
    if not reports_dir.is_dir():
        raise InputError(f"report folder does not exist: {reports_dir}")
    paths = sorted(path for path in reports_dir.glob("*.html") if path.is_file())
    if not paths:
        raise InputError(f"no HTML reports in {reports_dir}")
    index_path = root / "index.html"
    if index_path.exists() and not overwrite:
        raise InputError(f"report index already exists: {index_path}; pass --overwrite")
    prepared: list[tuple[_ReportEntry, bool]] = []
    for path in paths:
        entry, page = _read_entry(path)
        prepared.append((entry, _add_back_link(page, path) != page))
    entries = sorted(
        (entry for entry, _ in prepared),
        key=lambda entry: (
            (entry.artist or "").casefold(),
            entry.title.casefold(),
            entry.path.name,
        ),
    )
    write_report(index_path, _index_html(entries), overwrite=overwrite)
    linked = 0
    for entry, needs_link in prepared:
        if needs_link:
            _, page = _read_entry(entry.path)
            write_report(entry.path, _add_back_link(page, entry.path), overwrite=True)
            linked += 1
    return ReportIndexOutcome(index_path, len(entries), linked)
