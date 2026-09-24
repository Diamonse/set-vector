"""Vendored Beat This! runs only from the verified bundled weights and matches upstream."""

import runpy
from pathlib import Path

import numpy as np
import pytest

from setvector.analysis import beat_this
from setvector.domain import AnalysisError, InstallationError
from setvector.models import weights

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "tests" / "data" / "beat_this_reference.npz"
_SCRIPT = runpy.run_path(str(ROOT / "scripts" / "make_beat_this_reference.py"))
drum_pattern = _SCRIPT["drum_pattern"]
REFERENCE_SAMPLE_RATE = _SCRIPT["REFERENCE_SAMPLE_RATE"]


def nearest(values, reference):
    return np.min(np.abs(np.asarray(values)[:, None] - np.asarray(reference)[None, :]), axis=1)


def test_refinement_moves_a_peak_between_frames():
    frames = np.arange(100, dtype=float)
    parabola = -((frames - 40.3) ** 2)
    assert beat_this.refine_peak_times([40 / 50], parabola)[0] == pytest.approx(40.3 / 50)
    bump = np.exp(-(((frames - 60.25) / 1.5) ** 2))
    assert beat_this.refine_peak_times([60 / 50], bump)[0] == pytest.approx(60.25 / 50, abs=0.002)


def test_refinement_leaves_edges_and_flat_peaks_alone():
    activation = np.zeros(10)
    activation[5] = activation[6] = 1.0
    times = [0.0, 5 / 50, 9 / 50]
    np.testing.assert_array_equal(beat_this.refine_peak_times(times, activation), times)


def test_importing_the_detector_does_not_import_torch():
    import subprocess
    import sys

    code = "import sys, setvector.analysis.beat_this; print('torch' in sys.modules)"
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "False"


def test_missing_weights_are_an_installation_error(tmp_path):
    with pytest.raises(InstallationError, match="fetch_model"):
        beat_this.verify_weights(tmp_path / "missing.npz")


def test_corrupt_weights_are_an_installation_error(tmp_path):
    corrupt = tmp_path / "corrupt.npz"
    corrupt.write_bytes(b"not the model")
    with pytest.raises(InstallationError, match="unreadable"):
        beat_this.verify_weights(corrupt)


def test_altered_weights_are_an_installation_error(tmp_path):
    altered = tmp_path / "altered.npz"
    np.savez(altered, weight=np.zeros(3, np.float32))
    with pytest.raises(InstallationError, match="SHA-256"):
        beat_this.verify_weights(altered)


@pytest.mark.real_model
def test_detect_refuses_missing_weights(monkeypatch, tmp_path):
    monkeypatch.setattr(weights, "PATH", tmp_path / "missing.npz")
    with pytest.raises(InstallationError, match="fetch_model"):
        beat_this.detect(np.zeros(22_050, np.float32), 22_050)


@pytest.mark.real_model
def test_vendored_model_matches_upstream_reference():
    from setvector.analysis.beat_this import _inference

    with np.load(REFERENCE, allow_pickle=False) as reference:
        expected = {name: reference[name] for name in reference.files}
    samples, _, _ = drum_pattern(sample_rate=REFERENCE_SAMPLE_RATE)
    spect = _inference.log_mel(samples, REFERENCE_SAMPLE_RATE)
    beat, downbeat = _inference.frame_logits(beat_this.load_model(), spect)
    np.testing.assert_allclose(beat, expected["beat_logits"], atol=1e-3)
    np.testing.assert_allclose(downbeat, expected["downbeat_logits"], atol=1e-3)
    beats, downbeats = _inference.pick_peaks(beat, downbeat)
    np.testing.assert_array_equal(beats, expected["beats"])
    np.testing.assert_array_equal(downbeats, expected["downbeats"])


@pytest.mark.real_model
def test_bundled_model_finds_beats_and_downbeats_of_a_drum_pattern():
    samples, beats, downbeats = drum_pattern()
    detection = beat_this.detect(samples, 22_050)
    assert np.mean(nearest(beats, detection.beats) <= 0.04) >= 0.95
    assert abs(len(detection.beats) - len(beats)) <= 3
    assert abs(len(detection.downbeats) - len(downbeats)) <= 2
    assert np.mean(nearest(detection.downbeats, downbeats) <= 0.04) >= 0.8


def test_other_tests_get_the_stub():
    detection = beat_this.detect(np.zeros(10, np.float32), 22_050)
    assert detection.beats.size == 0 and detection.downbeats.size == 0


@pytest.mark.real_model
def test_multichannel_samples_are_a_clear_error():
    with pytest.raises(AnalysisError, match="mono"):
        beat_this.detect(np.zeros((2, 22_050), np.float32), 22_050)
