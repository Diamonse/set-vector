"""Choose one track's beat grid: Beat This! first, the baseline tracker second.

Each candidate's beats are fitted to a constant-tempo grid and scored. The first
reliable candidate wins; when neither is reliable the analysis has no grid, and its
reasons say why.
"""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from setvector.domain import (
    CandidateQuality,
    ExtractorIdentity,
    FeatureBundle,
    GridSegment,
    RhythmAnalysis,
)
from setvector.ingestion import DecodedAudio

from . import beat_this, grid
from .identity import (
    BAR_LENGTHS,
    BAR_PHASE_CONFIRM,
    INTERVAL_GAP_RATIO,
    MAX_INTERVAL_CV,
    MIN_BAR_REGULARITY,
    MIN_BEATS,
    MIN_DETECTION_SECONDS,
    MIN_GRID_FIT,
)

Runner = Callable[[np.ndarray, int], beat_this.Detection]


@dataclass(frozen=True, slots=True)
class _Candidate:
    name: str
    detected: np.ndarray
    fit: grid.GridFit | None
    quality: CandidateQuality
    bar_positions: tuple[int | None, ...]
    reasons: tuple[str, ...]


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _interval_cv(beats: np.ndarray) -> float | None:
    """Coefficient of variation of the intervals shorter than ``INTERVAL_GAP_RATIO`` medians.

    Longer intervals are gaps from missed beats, which ``grid_fit`` already measures;
    extra detections and erratic spacing still shorten intervals and raise the CV.
    """
    intervals = np.diff(beats)
    if intervals.size < 2:
        return None
    intervals = intervals[intervals < INTERVAL_GAP_RATIO * np.median(intervals)]
    if intervals.size < 2 or intervals.mean() <= 0:
        return None
    return float(intervals.std() / intervals.mean())


def _nearest(times: np.ndarray, targets: np.ndarray) -> np.ndarray:
    """Index of the closest of the strictly increasing ``times`` to each target.

    Exact ties go to the lower index. Memory is linear, so a long mix stays cheap.
    """
    targets = np.asarray(targets, dtype=np.float64)
    if times.size == 1:
        return np.zeros(targets.shape, dtype=np.intp)
    upper = np.clip(np.searchsorted(times, targets), 1, times.size - 1)
    lower = upper - 1
    closer_lower = np.abs(times[lower] - targets) <= np.abs(times[upper] - targets)
    return np.where(closer_lower, lower, upper)


def _downbeat_indices(beats: np.ndarray, downbeats: np.ndarray) -> np.ndarray:
    """Sorted unique beat indices of the downbeats that lie on a beat.

    A downbeat farther than half the median beat interval from its nearest beat, such
    as one before the first or after the last beat, would snap to an edge and fake a bar.
    """
    downbeats = np.asarray(downbeats, dtype=np.float64)
    if beats.size == 0 or downbeats.size == 0:
        return np.empty(0, dtype=np.intp)
    indices = _nearest(beats, downbeats)
    if beats.size > 1:
        tolerance = np.median(np.diff(beats)) / 2
        indices = indices[np.abs(beats[indices] - downbeats) <= tolerance]
    return np.unique(indices)


def _bar_stats(beats: np.ndarray, downbeats: np.ndarray) -> tuple[int | None, float | None]:
    lengths = np.diff(_downbeat_indices(beats, downbeats))
    if lengths.size == 0:
        return None, None
    modal = int(np.bincount(lengths).argmax())
    return modal, float(np.mean(lengths == modal))


def _bar_positions(grid_beats: np.ndarray, downbeats: np.ndarray, modal: int) -> tuple[int, ...]:
    """Number grid beats within bars of ``modal`` beats, following confirmed bar phases.

    Each downbeat's nearest grid beat index ``i`` votes for phase ``i % modal``; downbeats
    off the grid are ignored. A phase takes
    effect only where ``BAR_PHASE_CONFIRM`` consecutive downbeats share it, so a spurious or
    missed downbeat changes nothing, while a sustained shift starts a new phase at the first
    downbeat of its run. The first confirmed phase also numbers the pickup beats.
    """
    indices = _downbeat_indices(grid_beats, downbeats)
    phases = indices % modal
    run_starts = np.flatnonzero(np.r_[True, phases[1:] != phases[:-1]])
    run_lengths = np.diff(np.r_[run_starts, phases.size])
    confirmed = [
        (int(indices[start]), int(phases[start]))
        for start, length in zip(run_starts, run_lengths, strict=True)
        if length >= BAR_PHASE_CONFIRM
    ]
    if not confirmed:
        confirmed = [(0, int(np.bincount(phases, minlength=modal).argmax()))]
    changes = [(0, confirmed[0][1])]
    for index, phase in confirmed[1:]:
        if phase != changes[-1][1]:
            changes.append((index, phase))
    positions, current = [], 0
    for i in range(grid_beats.size):
        while current + 1 < len(changes) and i >= changes[current + 1][0]:
            current += 1
        positions.append((i - changes[current][1]) % modal + 1)
    return tuple(positions)


def _evaluate(name, detected, downbeats, duration) -> _Candidate:
    detected = np.asarray(detected, dtype=np.float64).ravel()
    detected = np.unique(detected[np.isfinite(detected)])
    fit = grid.fit_grid(detected, duration)
    # The fitted grid fills in missed beats, so a missed beat does not shorten its bar.
    bar_beats = detected if fit is None else fit.beats
    modal, regularity = (None, None) if downbeats is None else _bar_stats(bar_beats, downbeats)
    quality = CandidateQuality(
        beat_count=int(detected.size),
        interval_cv=_interval_cv(detected),
        grid_fit=None if fit is None else fit.grid_fit,
        segment_count=0 if fit is None else len(fit.segments),
        modal_bar_length=modal,
        bar_regularity=regularity,
    )
    reasons = []
    if detected.size < MIN_BEATS:
        reasons.append(f"{name}: {detected.size} beats, fewer than {MIN_BEATS}")
    if quality.interval_cv is None or quality.interval_cv > MAX_INTERVAL_CV:
        reasons.append(f"{name}: beat intervals vary too much (CV {_fmt(quality.interval_cv)})")
    if quality.grid_fit is None or quality.grid_fit < MIN_GRID_FIT:
        reasons.append(f"{name}: only {_fmt(quality.grid_fit)} of beats fit a steady grid")
    if downbeats is not None:
        if modal is None:
            reasons.append(f"{name}: no bars detected")
        elif modal not in BAR_LENGTHS:
            reasons.append(f"{name}: usual bar length is {modal} beats, not 3 or 4")
        elif regularity < MIN_BAR_REGULARITY:
            reasons.append(f"{name}: only {regularity:.2f} of bars have {modal} beats")
    positions: tuple[int | None, ...] = ()
    if fit is not None:
        if not reasons and downbeats is not None:
            positions = _bar_positions(fit.beats, np.asarray(downbeats, dtype=np.float64), modal)
        else:
            positions = (None,) * fit.beats.size
    return _Candidate(name, detected, fit, quality, positions, tuple(reasons))


def extract_rhythm(
    decoded: DecodedAudio,
    bundle: FeatureBundle,
    extractor: ExtractorIdentity,
    rhythm_id: str,
    runner: Runner | None = None,
) -> RhythmAnalysis:
    """Detect, fit, score, and select the beat grid for ``bundle``'s decoded audio."""
    duration = decoded.samples.shape[1] / decoded.sample_rate
    if duration >= MIN_DETECTION_SECONDS:
        run = beat_this.detect if runner is None else runner
        detection = run(decoded.samples.mean(axis=0), decoded.sample_rate)
        beats, downbeats = detection.beats, detection.downbeats
    else:
        beats, downbeats = np.empty(0), np.empty(0)
    candidates = [_evaluate("beat_this", beats, downbeats, duration)]
    if candidates[0].reasons:
        baseline = [beat.seconds for beat in bundle.measurements.beats]
        candidates.append(_evaluate("setvector_fallback", baseline, None, duration))
    chosen = next((c for c in candidates if not c.reasons), None)
    common = dict(
        rhythm_id=rhythm_id,
        asset_id=bundle.asset_id,
        feature_id=bundle.feature_id,
        extractor=extractor,
        quality={c.name: c.quality for c in candidates},
        reasons=tuple(reason for c in candidates for reason in c.reasons),
    )
    if chosen is None:
        return RhythmAnalysis(
            source="none",
            grid_segments=(),
            beats=(),
            bar_positions=(),
            detected_beats=(),
            tempo_bpm=None,
            reliable=False,
            **common,
        )
    segments, start = [], 0
    for segment in chosen.fit.segments:
        segments.append(
            GridSegment(
                start_seconds=segment.start_seconds,
                bpm=segment.bpm,
                beat_count=segment.beat_count,
                first_bar_position=chosen.bar_positions[start],
            )
        )
        start += segment.beat_count
    return RhythmAnalysis(
        source=chosen.name,
        grid_segments=tuple(segments),
        beats=tuple(t for segment in segments for t in segment.times()),
        bar_positions=chosen.bar_positions,
        detected_beats=tuple(float(t) for t in chosen.detected),
        tempo_bpm=max(segments, key=lambda segment: segment.beat_count).bpm,
        reliable=True,
        **common,
    )
