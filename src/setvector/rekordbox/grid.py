"""Convert between Rekordbox tempo markers and beat grids."""

import math
from collections.abc import Sequence

from setvector.domain import GridSegment, RhythmAnalysis
from setvector.domain._validation import finite_number

from .model import TempoMarker

MAX_BEATS_PER_MARKER = 200_000
DRIFT_TOLERANCE_SECONDS = 0.005


def expand_tempo(
    markers: Sequence[TempoMarker], duration_seconds: float
) -> tuple[tuple[float, ...], tuple[int, ...]]:
    """Return beat times and bar positions for Rekordbox markers over the decoded duration.

    Each marker is a beat anchor. Beats advance by ``60 / bpm`` to the next marker or the
    end, and ``beat_in_bar`` advances modulo the meter; a later marker resets both. A beat
    predicted within a quarter of the local interval (at most 120 ms) before the next
    marker is dropped, because Rekordbox rounds anchors to milliseconds; a marker closer than
    that guard to its successor contributes no beats, so the later marker wins. Nothing is
    extrapolated before the first marker.
    """
    duration_seconds = finite_number(duration_seconds, "duration_seconds")
    ordered = [marker for _, marker in sorted(enumerate(markers), key=_marker_order)]
    beats: list[float] = []
    positions: list[int] = []
    for index, marker in enumerate(ordered):
        interval = 60.0 / marker.bpm
        end = duration_seconds
        if index + 1 < len(ordered):
            following = ordered[index + 1]
            guard = min(0.120, interval * 0.25, 60.0 / following.bpm * 0.25)
            end = min(duration_seconds, following.start_seconds - guard)
        if marker.start_seconds >= end:
            continue
        count = math.ceil((end - marker.start_seconds - 1e-9) / interval)
        if count > MAX_BEATS_PER_MARKER:
            raise ValueError(
                f"the tempo marker at {marker.start_seconds} s ({marker.bpm} BPM) would expand"
                f" to more than {MAX_BEATS_PER_MARKER} beats"
            )
        for step in range(count):
            beat = marker.start_seconds + step * interval
            if beat >= end - 1e-9:
                continue
            position = (marker.beat_in_bar - 1 + step) % marker.beats_per_bar + 1
            if beats and beat - beats[-1] < 0.001:
                beats[-1], positions[-1] = beat, position
            else:
                beats.append(beat)
                positions.append(position)
    return tuple(beats), tuple(positions)


def _marker_order(item: tuple[int, TempoMarker]) -> tuple[float, int]:
    index, marker = item
    return marker.start_seconds, index


def tempo_markers_for(rhythm: RhythmAnalysis) -> tuple[TempoMarker, ...]:
    """Convert a reliable Beat This! grid into Rekordbox tempo markers.

    Rekordbox stores ``Inizio`` in milliseconds and ``Bpm`` with two decimals. A marker
    is added wherever that rounding would move a beat more than 5 ms from SetVector's
    grid, and wherever the bar phase does not continue modulo the meter. SetVector's grid
    engine leaves a gap of up to 1.5 periods between one segment's last beat and the next
    segment's start; a segment boundary also gets a bridging marker on that last beat
    whenever the previous marker would otherwise predict a spurious extra beat inside
    that gap, so no extra gridline appears between segments.
    """
    if rhythm.source != "beat_this" or not rhythm.reliable:
        raise ValueError("only a reliable beat_this rhythm has a bar grid to convert")
    bar_length = rhythm.quality["beat_this"].modal_bar_length
    if bar_length is None or any(p is None or p > bar_length for p in rhythm.bar_positions):
        raise ValueError("bar positions do not fit the meter")
    meter = f"{bar_length}/4"
    segments = rhythm.grid_segments
    markers: list[TempoMarker] = []
    first = 0
    for index, segment in enumerate(segments):
        times = segment.times()
        positions = rhythm.bar_positions[first : first + segment.beat_count]
        first += segment.beat_count
        bpm = round(segment.bpm, 2)
        period = 60.0 / bpm
        anchor = 0
        last_anchor = 0
        while anchor < len(times):
            start = round(times[anchor], 3)
            markers.append(TempoMarker(start, bpm, meter, positions[anchor]))
            last_anchor = anchor
            step = 1
            while anchor + step < len(times):
                expected_position = (positions[anchor] - 1 + step) % bar_length + 1
                drift = abs(start + step * period - times[anchor + step])
                if positions[anchor + step] != expected_position or drift > DRIFT_TOLERANCE_SECONDS:
                    break
                step += 1
            anchor += step
        if index + 1 < len(segments):
            _bridge_segment_gap(markers, times, positions, last_anchor, segments[index + 1], meter)
    return tuple(markers)


def _bridge_segment_gap(
    markers: list[TempoMarker],
    times: tuple[float, ...],
    positions: Sequence[int],
    last_anchor: int,
    next_segment: GridSegment,
    meter: str,
) -> None:
    """Retime or add a marker on a segment's last beat to bridge the gap that follows it.

    Without this, the segment's last marker would keep advancing by its own period and
    could predict a beat inside the gap before the next segment's marker, the same way
    ``expand_tempo`` would read it back. Retiming that final beat to land its next
    predicted beat on (or within the guard of) the next segment's marker makes
    ``expand_tempo`` drop it instead, as it does for any two markers that close together.
    """
    last_marker = markers[-1]
    last_period = 60.0 / last_marker.bpm
    run_length = len(times) - last_anchor
    predicted_next = last_marker.start_seconds + run_length * last_period
    next_bpm = round(next_segment.bpm, 2)
    next_period = 60.0 / next_bpm
    guard = min(0.120, last_period / 4, next_period / 4)
    next_start = round(next_segment.start_seconds, 3)
    if predicted_next >= next_start - guard:
        return
    last_beat = round(times[-1], 3)
    bridge_bpm = round(60.0 / (next_start - last_beat), 2)
    bridge = TempoMarker(last_beat, bridge_bpm, meter, positions[-1])
    if run_length == 1:
        markers[-1] = bridge
    else:
        markers.append(bridge)
