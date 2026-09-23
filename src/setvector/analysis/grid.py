"""Piecewise-constant tempo grids fitted to detected beat times.

Pure NumPy with no detector knowledge. Each segment has one beat period, so tempo
markers and bar counting stay exact and per-beat detector jitter averages out.
"""

from dataclasses import dataclass

import numpy as np

from .identity import (
    GRID_ACCEPT_FRACTION,
    GRID_MAX_SEGMENTS,
    GRID_MIN_SPLIT_BEATS,
    GRID_TOLERANCE_SECONDS,
)

MAX_SEGMENTS = GRID_MAX_SEGMENTS
_REFITS = 5


@dataclass(frozen=True, slots=True)
class Segment:
    """Grid beats ``start_seconds + n * period`` for ``n`` in ``range(beat_count)``."""

    start_seconds: float
    period: float
    beat_count: int

    @property
    def bpm(self) -> float:
        return 60.0 / self.period

    def times(self) -> np.ndarray:
        return self.start_seconds + np.arange(self.beat_count) * self.period


@dataclass(frozen=True, slots=True)
class GridFit:
    """Fitted segments, their concatenated beats, and the share of detected beats they explain."""

    segments: tuple[Segment, ...]
    beats: np.ndarray
    grid_fit: float


def _initial_indices(times: np.ndarray) -> np.ndarray:
    """Count beat periods from the last beat that sat on the grid.

    A beat far from a whole number of periods (an extra detection between two beats)
    gets an index but does not become the anchor, so it cannot shift later indices.
    """
    period = float(np.median(np.diff(times)))
    indices = np.zeros(times.size, dtype=np.int64)
    anchor_time, anchor_index = float(times[0]), 0
    for i in range(1, times.size):
        steps = (times[i] - anchor_time) / period
        indices[i] = anchor_index + round(steps)
        if abs(steps - round(steps)) <= 0.25:
            anchor_time, anchor_index = float(times[i]), int(indices[i])
    return indices


def _fit_line(times: np.ndarray) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Return ``(period, offset, indices, inliers)`` of one robust constant-tempo line."""
    indices = _initial_indices(times)
    keep = np.ones(times.size, dtype=bool)
    period, offset = float(np.median(np.diff(times))), float(times[0])
    for _ in range(_REFITS):
        if np.unique(indices[keep]).size < 2:
            break
        slope, intercept = np.polyfit(indices[keep], times[keep], 1)
        if slope <= 0:
            break
        period, offset = float(slope), float(intercept)
        indices = np.round((times - offset) / period).astype(np.int64)
        keep = np.abs(times - (offset + period * indices)) <= GRID_TOLERANCE_SECONDS
    keep = np.abs(times - (offset + period * indices)) <= GRID_TOLERANCE_SECONDS
    return period, offset, indices, keep


def _inliers(times: np.ndarray) -> int:
    return int(_fit_line(times)[3].sum())


def _ranges(times: np.ndarray) -> list[tuple[int, int]]:
    """Split beat positions into contiguous ranges that each fit one tempo."""
    pending, accepted = [(0, times.size)], []
    while pending:
        start, stop = pending.pop(0)
        keep = _fit_line(times[start:stop])[3]
        room = len(accepted) + len(pending) + 2 <= GRID_MAX_SEGMENTS
        if (
            keep.mean() >= GRID_ACCEPT_FRACTION
            or stop - start < 2 * GRID_MIN_SPLIT_BEATS
            or not room
        ):
            accepted.append((start, stop))
            continue
        split = max(
            range(start + GRID_MIN_SPLIT_BEATS, stop - GRID_MIN_SPLIT_BEATS + 1),
            key=lambda s: _inliers(times[start:s]) + _inliers(times[s:stop]),
        )
        pending[:0] = [(start, split), (split, stop)]
    return sorted(accepted)


def fit_grid(times, duration: float) -> GridFit | None:
    """Fit segments to sorted beat ``times`` and emit grid beats inside ``[0, duration]``."""
    times = np.asarray(times, dtype=np.float64)
    if times.size < 2:
        return None
    segments: list[Segment] = []
    inliers = 0
    previous_end = -np.inf
    for start, stop in _ranges(times):
        period, offset, indices, keep = _fit_line(times[start:stop])
        inliers += int(keep.sum())
        emitted = offset + period * np.arange(indices.min(), indices.max() + 1)
        emitted = emitted[
            (emitted >= 0.0) & (emitted <= duration) & (emitted > previous_end + period / 2)
        ]
        if emitted.size == 0:
            continue
        segment = Segment(float(emitted[0]), period, int(emitted.size))
        segments.append(segment)
        previous_end = float(segment.times()[-1])
    beats = np.concatenate([s.times() for s in segments]) if segments else np.empty(0)
    return GridFit(tuple(segments), beats, inliers / times.size)
