"""The Rekordbox probe builds deterministic drum tracks and stage cue requests."""

import runpy
from pathlib import Path

import numpy as np
import pytest

from setvector.rekordbox import CueRequest

PROBE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "rekordbox_probe.py"))


def test_drum_track_places_downbeats_on_each_tempo_section():
    samples, downbeats = PROBE["drum_track"](((120.0, 2), (128.0, 2)), 0.5)
    assert samples.shape[1] == 2
    assert samples.dtype == np.float32
    assert downbeats == pytest.approx([0.5, 2.5, 4.5, 4.5 + 4 * 60 / 128])


def test_stage_two_moves_removes_and_adds_setvector_cues(tmp_path):
    downbeats = {name: [float(i) for i in range(50)] for name in PROBE["TRACKS"]}
    first = PROBE["stage_requests"](tmp_path, downbeats, 1)
    second = PROBE["stage_requests"](tmp_path, downbeats, 2)
    one = tmp_path / "probe-1-constant-120.wav"
    before = {request.label: request for request in first[one]}
    after = {request.label: request for request in second[one]}
    assert "Hot B" in before and "Hot B" not in after
    assert after["Hot A"].start_seconds != before["Hot A"].start_seconds
    assert after["Hot N"].preferred_slot == 7
    assert "Mem 01b" in after and "Mem 01" not in after
    assert all(isinstance(r, CueRequest) for requests in first.values() for r in requests)
    two = tmp_path / "probe-2-tempo-change.wav"
    assert {request.preferred_slot for request in first[two]} == set(range(8))


def test_stage2_on_an_empty_folder_reports_a_friendly_error(tmp_path, capsys):
    status = PROBE["main"](["stage2", str(tmp_path), "--library", str(tmp_path / "export.xml")])
    assert status == 1
    assert "run generate first" in capsys.readouterr().err


def test_check_with_a_missing_export_reports_an_error(tmp_path, capsys):
    status = PROBE["main"](["check", str(tmp_path), "--export1", str(tmp_path / "export-1.xml")])
    assert status == 1
    assert capsys.readouterr().err.startswith("error:")
