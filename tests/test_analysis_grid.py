"""Piecewise-constant tempo grids fitted to detected beats."""

import numpy as np
import pytest

from setvector.analysis import grid


def quantized_beats(bpm=124.0, count=400, start=0.3, fps=50):
    """Beats at ``bpm`` rounded to a detector's frame grid, like Beat This! output."""
    return np.round((start + np.arange(count) * 60.0 / bpm) * fps) / fps


def test_quantized_beats_recover_the_true_tempo():
    beats = quantized_beats()
    # The frame grid makes the median interval read 0.48 s, i.e. 125 BPM.
    assert 60.0 / np.median(np.diff(beats)) == pytest.approx(125.0)
    fit = grid.fit_grid(beats, duration=beats[-1] + 1.0)
    assert len(fit.segments) == 1
    assert fit.segments[0].bpm == pytest.approx(124.0, abs=0.01)
    assert fit.grid_fit == 1.0
    assert fit.beats.size == beats.size
    np.testing.assert_allclose(fit.beats, fit.segments[0].times())


def test_missed_and_extra_beats_do_not_change_tempo():
    rng = np.random.default_rng(1)
    full = quantized_beats()
    interior = np.arange(20, full.size - 20)
    kept = np.delete(full, rng.choice(interior, size=40, replace=False))
    extras = full[rng.choice(interior, size=5, replace=False)] + 0.5 * 60.0 / 124.0
    beats = np.unique(np.concatenate([kept, extras]))
    fit = grid.fit_grid(beats, duration=full[-1] + 1.0)
    assert len(fit.segments) == 1
    assert fit.segments[0].bpm == pytest.approx(124.0, abs=0.01)
    assert fit.beats.size == full.size  # missed beats are filled in, extras are not


def test_tempo_change_splits_into_two_segments_at_the_change():
    slow = 0.5 + np.arange(64) * 0.5
    fast = slow[-1] + 60.0 / 128.0 + np.arange(64) * 60.0 / 128.0
    beats = np.concatenate([slow, fast])
    fit = grid.fit_grid(beats, duration=fast[-1] + 1.0)
    # A boundary beat within tolerance of both lines may join either segment and bias it
    # by about 0.01 BPM.
    assert [s.bpm for s in fit.segments] == pytest.approx([120.0, 128.0], abs=0.05)
    end_of_first = fit.segments[0].times()[-1]
    assert abs(end_of_first - slow[-1]) <= 4 * 0.5
    assert np.all(np.diff(fit.beats) > 0)
    assert fit.grid_fit >= 0.95


def test_short_irregular_sequences_are_never_split():
    rng = np.random.default_rng(2)
    beats = np.sort(rng.uniform(0, 40, size=50))
    fit = grid.fit_grid(beats, duration=41.0)
    assert len(fit.segments) == 1


def test_random_beats_fit_poorly():
    rng = np.random.default_rng(3)
    beats = np.sort(rng.uniform(0, 120, size=200))
    fit = grid.fit_grid(beats, duration=121.0)
    assert fit.grid_fit < 0.90
    assert len(fit.segments) <= grid.MAX_SEGMENTS


def test_grid_stays_inside_the_audio():
    beats = 0.01 + np.arange(40) * 0.5
    fit = grid.fit_grid(beats, duration=beats[-1] + 0.1)
    assert fit.beats[0] >= 0.0
    assert fit.beats[-1] <= beats[-1] + 0.1


def test_fewer_than_two_beats_has_no_grid():
    assert grid.fit_grid(np.array([1.0]), duration=5.0) is None
    assert grid.fit_grid(np.array([]), duration=5.0) is None
