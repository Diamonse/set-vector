"""Convert between Rekordbox tempo markers and beat grids."""

import math
from collections.abc import Sequence

from setvector.domain._validation import finite_number

from .model import TempoMarker

MAX_BEATS_PER_MARKER = 200_000


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
