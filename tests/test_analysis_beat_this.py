"""Beat This! runs only from the verified bundled checkpoint."""

import numpy as np
import pytest

from setvector.analysis import beat_this
from setvector.domain import InstallationError
from setvector.models import checkpoint


def drum_pattern(sample_rate=22_050, bpm=120.0, bars=16, start=0.5):
    """Kick on every beat, snare on 2 and 4, off-beat hats, a bass note and crash on bar 1."""
    period = 60.0 / bpm
    size = int(sample_rate * (start + bars * 4 * period + 1))
    signal = np.zeros(size)
    rng = np.random.default_rng(3)

    def put(sound, at, gain):
        i = int(at * sample_rate)
        signal[i : i + sound.size] += gain * sound[: size - i]

    def decay(seconds, tau):
        return np.exp(-np.arange(int(seconds * sample_rate)) / sample_rate / tau)

    t = np.arange(int(0.2 * sample_rate)) / sample_rate
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    snare = rng.standard_normal(int(0.15 * sample_rate)) * decay(0.15, 0.04)
    hat = rng.standard_normal(int(0.04 * sample_rate)) * decay(0.04, 0.01)
    crash = rng.standard_normal(sample_rate) * decay(1.0, 0.3)
    beats = start + np.arange(bars * 4) * period
    for i, beat in enumerate(beats):
        put(kick, beat, 0.9)
        if i % 4 in (1, 3):
            put(snare, beat, 0.5)
        put(hat, beat + period / 2, 0.2)
    bar_t = np.arange(int(4 * period * sample_rate)) / sample_rate
    for j, downbeat in enumerate(beats[::4]):
        root = (55.0, 43.65, 49.0, 41.2)[j % 4]
        put(np.sin(2 * np.pi * root * bar_t) * np.minimum(1, bar_t / 0.01), downbeat, 0.3)
        if j % 4 == 0:
            put(crash, downbeat, 0.3)
    signal = 0.9 * signal / np.abs(signal).max()
    return signal.astype(np.float32), beats, beats[::4]


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


@pytest.mark.real_model
def test_missing_checkpoint_is_an_installation_error(monkeypatch, tmp_path):
    monkeypatch.setattr(checkpoint, "PATH", tmp_path / "missing.ckpt")
    with pytest.raises(InstallationError, match="fetch_model"):
        beat_this.detect(np.zeros(22_050, np.float32), 22_050)


def test_altered_checkpoint_is_an_installation_error(monkeypatch, tmp_path):
    altered = tmp_path / "altered.ckpt"
    altered.write_bytes(b"not the model")
    monkeypatch.setattr(checkpoint, "PATH", altered)
    with pytest.raises(InstallationError, match="SHA-256"):
        beat_this.verify_checkpoint()


@pytest.mark.real_model
def test_bundled_model_finds_beats_and_downbeats_of_a_drum_pattern():
    samples, beats, downbeats = drum_pattern()
    detection = beat_this.detect(samples, 22_050)
    assert np.mean(nearest(beats, detection.beats) <= 0.04) >= 0.95
    assert abs(len(detection.downbeats) - len(downbeats)) <= 2
    assert np.mean(nearest(detection.downbeats, downbeats) <= 0.04) >= 0.8


def test_other_tests_get_the_stub(monkeypatch):
    detection = beat_this.detect(np.zeros(10, np.float32), 22_050)
    assert detection.beats.size == 0 and detection.downbeats.size == 0
