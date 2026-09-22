"""Vendored front-end assets ship inside the package."""

import shutil
import subprocess
from importlib.resources import files

import pytest

ASSETS = files("setvector.visualization").joinpath("assets")
VENDORED = (
    "uPlot.iife.min.js",
    "uPlot.min.css",
    "inter-latin-wght-normal.woff2",
    "inter-latin-ext-wght-normal.woff2",
    "LICENSES/uPlot-LICENSE.txt",
    "LICENSES/Inter-OFL.txt",
)


@pytest.mark.parametrize("name", VENDORED)
def test_vendored_asset_is_packaged(name):
    assert ASSETS.joinpath(name).is_file()


def test_vendored_versions_and_licenses():
    header = ASSETS.joinpath("uPlot.iife.min.js").read_text(encoding="utf-8")[:80]
    assert "(v1.6.32)" in header
    assert "MIT" in ASSETS.joinpath("LICENSES/uPlot-LICENSE.txt").read_text(encoding="utf-8")
    ofl = ASSETS.joinpath("LICENSES/Inter-OFL.txt").read_text(encoding="utf-8")
    assert "SIL Open Font License, Version 1.1" in ofl


def test_fonts_are_woff2():
    for name in ("inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"):
        assert ASSETS.joinpath(name).read_bytes()[:4] == b"wOF2"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_report_script_is_valid_javascript(tmp_path):
    script = tmp_path / "report.js"
    script.write_text(ASSETS.joinpath("report.js").read_text(encoding="utf-8"), encoding="utf-8")
    result = subprocess.run(
        ["node", "--check", str(script)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("name", ["report.html", "report.css", "report.js"])
def test_report_sources_are_packaged(name):
    assert ASSETS.joinpath(name).is_file()
