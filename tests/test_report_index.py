"""Collections link existing offline reports back to their song list."""

import json
import subprocess
import sys

import pytest

from setvector.application import create_report_index
from setvector.domain import InputError
from setvector.visualization import build_report_model, render_report_html


def _report(path, report_inputs, *, name, warnings=()):
    asset, bundle = report_inputs(name=name, warnings=warnings)
    page = render_report_html(build_report_model(asset, bundle))
    path.write_text(page, encoding="utf-8")
    return page


def test_report_index_links_each_report_and_escapes_metadata(tmp_path, report_inputs):
    reports = tmp_path / "reports"
    reports.mkdir()
    first = reports / "A & B.html"
    second = reports / "second.html"
    _report(first, report_inputs, name="DJ <script> - Bad & Song.mp3", warnings=("check",))
    _report(second, report_inputs, name="Other - Another Song.mp3")

    outcome = create_report_index(tmp_path)

    assert outcome.index_path == tmp_path / "index.html"
    assert (outcome.report_count, outcome.linked_count) == (2, 2)
    index = outcome.index_path.read_text(encoding="utf-8")
    assert "DJ &lt;script&gt; - Bad &amp; Song" in index
    assert "DJ <script>" not in index
    assert 'href="reports/A%20%26%20B.html"' in index
    assert 'href="reports/second.html"' in index
    assert ">1</td>" in index  # One report carries an analysis warning.
    for path in (first, second):
        page = path.read_text(encoding="utf-8")
        assert page.count('data-setvector-index-nav="1"') == 1
        assert 'href="../index.html"' in page


def test_report_index_rebuild_is_explicit_and_does_not_duplicate_links(tmp_path, report_inputs):
    reports = tmp_path / "reports"
    reports.mkdir()
    report = reports / "track.html"
    _report(report, report_inputs, name="Artist - Track.mp3")
    create_report_index(tmp_path)
    once = report.read_bytes()

    with pytest.raises(InputError, match="--overwrite"):
        create_report_index(tmp_path)
    assert report.read_bytes() == once

    result = create_report_index(tmp_path, overwrite=True)
    assert result.linked_count == 0
    assert report.read_bytes() == once


def test_invalid_report_does_not_change_other_reports(tmp_path, report_inputs):
    reports = tmp_path / "reports"
    reports.mkdir()
    good = reports / "good.html"
    original = _report(good, report_inputs, name="Artist - Track.mp3")
    (reports / "bad.html").write_text("<html>not a SetVector report</html>", encoding="utf-8")

    with pytest.raises(InputError, match="not a SetVector report"):
        create_report_index(tmp_path)

    assert good.read_text(encoding="utf-8") == original
    assert not (tmp_path / "index.html").exists()


def test_report_index_cli_returns_index_location(tmp_path, report_inputs):
    reports = tmp_path / "reports"
    reports.mkdir()
    _report(reports / "track.html", report_inputs, name="Artist - Track.mp3")

    completed = subprocess.run(
        [sys.executable, "-m", "setvector", "report-index", str(tmp_path)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "index_path": str(tmp_path / "index.html"),
        "report_count": 1,
        "linked_count": 1,
    }
    assert completed.stderr == ""
