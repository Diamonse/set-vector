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
        """Tempo in beats per minute."""
        return 60.0 / self.period

    def times(self) -> np.ndarray:
        """Grid beat times in seconds."""
        return self.start_seconds + np.arange(self.beat_count) * self.period


@dataclass(frozen=True, slots=True)
class GridFit:
    """Fitted segments, their concatenated beats, and the share of detected beats they explain."""

    segments: tuple[Segment, ...]
    beats: np.ndarray
    grid_fit: float


def _reference_period(times: np.ndarray) -> float:
    """Mean of the intervals within 25% of the median interval, else the median.

    The median of frame-quantized intervals snaps to a whole frame (0.48 s at 50 fps for
    124-126 BPM); averaging the typical intervals removes that bias, so beat indices stay
    right across long runs of missed beats. With two interval clusters the median can
    fall between them, leaving no typical interval to average.
    """
    intervals = np.diff(times)
    median = float(np.median(intervals))
    typical = intervals[np.abs(intervals / median - 1.0) < 0.25]
    return float(typical.mean()) if typical.size else median


def _initial_indices(times: np.ndarray) -> np.ndarray:
    """Count beat periods from the last beat that sat on the grid.

    A beat far from a whole number of periods (an extra detection between two beats)
    gets an index but does not become the anchor, so it cannot shift later indices.
    """
    period = _reference_period(times)
    indices = np.zeros(times.size, dtype=np.int64)
    anchor_time, anchor_index = float(times[0]), 0
    for i in range(1, times.size):
        steps = (times[i] - anchor_time) / period
        indices[i] = anchor_index + round(steps)
        if abs(steps - round(steps)) <= 0.25:
            anchor_time, anchor_index = float(times[i]), int(indices[i])
    return indices


def _fit_line(times: np.ndarray) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Return ``(period, offset, indices, inliers)`` of one robust constant-tempo line.

    A period no longer than twice the tolerance would count almost any detection as an
    inlier, so such a line explains nothing.
    """
    indices = _initial_indices(times)
    keep = np.ones(times.size, dtype=bool)
    period, offset = _reference_period(times), float(times[0])
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
    if period <= 2 * GRID_TOLERANCE_SECONDS:
        keep[:] = False
    return period, offset, indices, keep


def _split_cost(times: np.ndarray) -> float:
    """Sum of squared residuals from one tempo line, each capped at the tolerance.

    Near a tempo change a line through both tempos still keeps most beats within the
    tolerance, so inlier counts barely change with the split point; this truncated
    squared error is smallest when each side holds a single tempo.
    """
    period, offset, indices, _ = _fit_line(times)
    residuals = np.minimum(np.abs(times - (offset + period * indices)), GRID_TOLERANCE_SECONDS)
    return float(np.square(residuals).sum())


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
        split = _best_split(times, start, stop)
        pending[:0] = [(start, split), (split, stop)]
    return _tidy(times, sorted(accepted))


def _tidy(times: np.ndarray, ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Merge neighbours that fit one tempo together and re-place boundaries until stable.

    Greedy splitting can leave a short range of mixed beats beside a tempo change and
    boundaries a few beats off; both are corrected using only the two ranges involved.
    Moving a boundary can make a new pair mergeable, so the passes repeat until nothing
    changes, within a fixed number of rounds in case boundary moves alternate.
    """
    for _ in range(2 * GRID_MAX_SEGMENTS):
        merged = [ranges[0]]
        for start, stop in ranges[1:]:
            first = merged[-1][0]
            if _fit_line(times[first:stop])[3].mean() >= GRID_ACCEPT_FRACTION:
                merged[-1] = (first, stop)
            else:
                merged.append((start, stop))
        for i in range(1, len(merged)):
            first, last = merged[i - 1][0], merged[i][1]
            if last - first >= 2 * GRID_MIN_SPLIT_BEATS:
                split = _best_split(times, first, last)
                merged[i - 1], merged[i] = (first, split), (split, last)
        if merged == ranges:
            break
        ranges = merged
    return ranges


def _best_split(times: np.ndarray, start: int, stop: int) -> int:
    """Return the split with the smallest combined capped error, searched coarse-to-fine.

    A coarse stride keeps long tracks cheap; the refinement pass around the best coarse
    candidate recovers the exact beat. Ties keep the earliest split.
    """

    def cost(split: int) -> float:
        return _split_cost(times[start:split]) + _split_cost(times[split:stop])

    lo, hi = start + GRID_MIN_SPLIT_BEATS, stop - GRID_MIN_SPLIT_BEATS
    step = max(1, (hi - lo) // 64)
    best = min(range(lo, hi + 1, step), key=cost)
    return min(range(max(lo, best - step), min(hi, best + step) + 1), key=cost)


def _close_gaps(segments: list[Segment]) -> list[Segment]:
    """Extend each segment with its own period up to the next one.

    Tempo markers cannot express a hole: an earlier marker lasts until the next starts.
    Each segment keeps adding beats while they fall more than half its period before
    the next segment's start, so consecutive beats stay strictly increasing.
    """
    closed = []
    for segment, following in zip(segments, segments[1:], strict=False):
        limit = following.start_seconds - segment.period / 2
        count = segment.beat_count
        while segment.start_seconds + count * segment.period < limit:
            count += 1
        closed.append(Segment(segment.start_seconds, segment.period, count))
    closed.append(segments[-1])
    return closed


def fit_grid(times, duration: float) -> GridFit | None:
    """Fit segments to beat ``times`` and emit grid beats inside ``[0, duration]``.

    Times are sorted and de-duplicated and non-finite values dropped. Returns ``None``
    when fewer than two beats remain or no grid beat falls inside the audio.
    """
    times = np.asarray(times, dtype=np.float64).ravel()
    times = np.unique(times[np.isfinite(times)])
    if times.size < 2:
        return None
    segments: list[Segment] = []
    inliers = 0
    previous_end = -np.inf
    for start, stop in _ranges(times):
        period, offset, indices, keep = _fit_line(times[start:stop])
        if not keep.any():
            continue
        first = offset + period * indices.min()
        candidates = first + np.arange(indices.max() - indices.min() + 1) * period
        valid = np.flatnonzero((candidates >= 0.0) & (candidates > previous_end + period / 2))
        if valid.size == 0:
            continue
        # Rebuild from the first valid beat with Segment.times() arithmetic so the upper
        # bound is tested on exactly the values the segment will emit.
        start_seconds = float(candidates[valid[0]])
        emitted = start_seconds + np.arange(valid.size) * period
        count = int(np.searchsorted(emitted, duration, side="right"))
        if count == 0:
            continue
        inliers += int(keep.sum())
        segments.append(Segment(start_seconds, period, count))
        previous_end = float(segments[-1].times()[-1])
    if not segments:
        return None
    segments = _close_gaps(segments)
    beats = np.concatenate([s.times() for s in segments])
    return GridFit(tuple(segments), beats, inliers / times.size)
