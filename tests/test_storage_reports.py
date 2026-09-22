"""Atomic report files that never replace existing work by accident."""

import os

import pytest

import setvector.storage.reports as reports_module
from setvector.domain import ArtifactError, InputError
from setvector.storage import write_report


def test_write_report_creates_parents_and_returns_absolute_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    path = write_report("reports dir/näme.html", "<p>ok</p>")
    assert path == (tmp_path / "reports dir" / "näme.html").resolve()
    assert path.read_text(encoding="utf-8") == "<p>ok</p>"


def test_existing_report_is_kept_without_overwrite(tmp_path):
    target = tmp_path / "report.html"
    target.write_text("original", encoding="utf-8")
    with pytest.raises(InputError, match="--overwrite"):
        write_report(target, "new")
    assert target.read_text(encoding="utf-8") == "original"
    assert write_report(target, "new", overwrite=True).read_text(encoding="utf-8") == "new"


def test_directory_target_is_rejected(tmp_path):
    with pytest.raises(InputError, match="directory"):
        write_report(tmp_path, "x", overwrite=True)


def test_failed_replace_leaves_no_file_behind(tmp_path, monkeypatch):
    def failing_replace(source, target):
        raise OSError("simulated")

    monkeypatch.setattr(reports_module.os, "replace", failing_replace)
    with pytest.raises(ArtifactError, match="cannot write report"):
        write_report(tmp_path / "report.html", "x")
    assert os.listdir(tmp_path) == []
