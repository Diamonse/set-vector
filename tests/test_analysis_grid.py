"""Piecewise-constant tempo grids fitted to detected beats."""

import time

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


def test_duplicate_beats_have_no_grid():
    assert grid.fit_grid(np.array([1.0, 1.0]), duration=5.0) is None


def test_unsorted_beats_fit_like_sorted_beats():
    beats = np.array([3.0, 1.0, 2.0, 0.5, 2.5, 1.5])
    unsorted_fit = grid.fit_grid(beats, duration=5.0)
    sorted_fit = grid.fit_grid(np.sort(beats), duration=5.0)
    assert unsorted_fit.segments == sorted_fit.segments
    np.testing.assert_array_equal(unsorted_fit.beats, sorted_fit.beats)
    assert unsorted_fit.grid_fit == sorted_fit.grid_fit
    assert unsorted_fit.segments[0].bpm == pytest.approx(120.0)


def test_non_finite_beats_are_ignored():
    beats = 0.5 + np.arange(40) * 0.5
    noisy = np.insert(beats, [10, 20, 30], [np.nan, np.inf, -np.inf])
    fit = grid.fit_grid(noisy, duration=beats[-1] + 1.0)
    clean = grid.fit_grid(beats, duration=beats[-1] + 1.0)
    assert fit.segments == clean.segments
    assert fit.grid_fit == 1.0


def test_grid_entirely_outside_the_audio_has_no_grid():
    beats = 10.0 + np.arange(20) * 0.5
    assert grid.fit_grid(beats, duration=5.0) is None


def test_long_track_with_three_tempos_splits_quickly():
    first = 0.5 + np.arange(700) * 60.0 / 120.0
    second = first[-1] + (1 + np.arange(600)) * 60.0 / 124.0
    third = second[-1] + (1 + np.arange(700)) * 60.0 / 128.0
    beats = np.concatenate([first, second, third])
    started = time.perf_counter()
    fit = grid.fit_grid(beats, duration=third[-1] + 1.0)
    elapsed = time.perf_counter() - started
    assert [s.bpm for s in fit.segments] == pytest.approx([120.0, 124.0, 128.0], abs=0.05)
    assert elapsed < 5.0
