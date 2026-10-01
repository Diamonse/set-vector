"""Compare Rekordbox XML that SetVector wrote with Rekordbox's export after importing it."""

import os
from collections import Counter

from .model import PositionMark, RekordboxLibrary, RekordboxTrack, TempoMarker

EXACT_SECONDS = 0.0005
ROUNDED_SECONDS = 0.005
BPM_TOLERANCE = 0.005
TEMPO_MATCH_SECONDS = 0.5
UNNAMED_MATCH_SECONDS = 1.0
_SLOT_NAMES = "ABCDEFGH"


def compare_libraries(expected: RekordboxLibrary, actual: RekordboxLibrary) -> list[dict[str, str]]:
    """Return one finding per expected track, marker and mark, plus extra marks found.

    Each finding has ``track``, ``item``, ``result`` (``kept``, ``rounded``, ``changed``,
    ``missing``, ``duplicated`` or ``extra``) and ``detail``. Tracks match by decoded path.
    """
    by_location: dict[str, list[RekordboxTrack]] = {}
    for track in actual.tracks:
        by_location.setdefault(_location_key(track), []).append(track)
    findings: list[dict[str, str]] = []
    for track in expected.tracks:
        name = track.attribute("Name") or track.location
        matches = by_location.get(_location_key(track), [])
        if not matches:
            findings.append(_finding(name, "track", "missing", ""))
            continue
        if len(matches) > 1:
            findings.append(_finding(name, "track", "duplicated", f"{len(matches)} records"))
        for item, result, detail in compare_track(track, matches[0]):
            findings.append(_finding(name, item, result, detail))
    return findings


def compare_track(expected: RekordboxTrack, actual: RekordboxTrack) -> list[tuple[str, str, str]]:
    """Compare one written track with Rekordbox's record of it.

    Tempo markers and marks are each matched by nearest-time, one-to-one, so an inserted or
    deleted marker never shifts every later comparison out of alignment (see ``_pair_nearest``).
    """
    results = _compare_tempo(expected.tempo, actual.tempo)
    results.extend(_compare_marks(expected.marks, actual.marks))
    return results


def _pair_nearest(
    expected_starts: list[float],
    actual_starts: list[float],
    same_group: list[list[int]],
    tolerances: list[float],
) -> dict[int, int]:
    """Pair each expected index with the nearest unconsumed actual index in its group.

    ``same_group[i]`` lists the actual indices eligible to match expected index ``i``, and
    ``tolerances[i]`` bounds how far the match may be. Each actual index is consumed by at
    most one expected index, chosen in expected order.
    """
    consumed: set[int] = set()
    pairs: dict[int, int] = {}
    for i, group in enumerate(same_group):
        candidates = [j for j in group if j not in consumed]
        if not candidates:
            continue
        best = min(candidates, key=lambda j: abs(actual_starts[j] - expected_starts[i]))
        if abs(actual_starts[best] - expected_starts[i]) > tolerances[i]:
            continue
        pairs[i] = best
        consumed.add(best)
    return pairs


def _compare_tempo(
    expected: tuple[TempoMarker, ...], actual: tuple[TempoMarker, ...]
) -> list[tuple[str, str, str]]:
    """Compare tempo markers by nearest start time, not by list position."""
    results: list[tuple[str, str, str]] = []
    if len(expected) != len(actual):
        detail = f"{len(expected)} written, {len(actual)} exported"
        results.append(("tempo markers", "changed", detail))
    groups = [list(range(len(actual)))] * len(expected)
    pairs = _pair_nearest(
        [marker.start_seconds for marker in expected],
        [marker.start_seconds for marker in actual],
        groups,
        [TEMPO_MATCH_SECONDS] * len(expected),
    )
    for index, want in enumerate(expected):
        label = f"tempo {index + 1}"
        if index not in pairs:
            results.append((label, "missing", ""))
            continue
        got = actual[pairs[index]]
        same_grid = (want.meter, want.beat_in_bar) == (got.meter, got.beat_in_bar)
        if not same_grid or abs(want.bpm - got.bpm) > BPM_TOLERANCE:
            detail = f"wrote {_tempo_text(want)}, exported {_tempo_text(got)}"
            results.append((label, "changed", detail))
        else:
            timing = _timing(want.start_seconds, got.start_seconds)
            results.append((label, timing, _delta(want.start_seconds, got.start_seconds)))
    matched = set(pairs.values())
    for index, got in enumerate(actual):
        if index not in matched:
            label = f"tempo at {got.start_seconds:.3f} s"
            results.append((label, "extra", f"{got.bpm:.2f} BPM"))
    return results


def _identity_key(mark: PositionMark) -> tuple[str, str | int]:
    """A hot cue's identity is its slot; a memory mark's is its kind and name."""
    if mark.slot is not None:
        return ("hot", mark.slot)
    return (mark.kind, mark.name)


def _match_tolerance(mark: PositionMark) -> float:
    """How far a candidate may drift and still count as the same mark.

    A hot cue's slot and a named memory mark's name are themselves a strong identity, so
    matching is unbounded. An unnamed memory mark's identity is only its kind, which many
    unrelated marks can share, so a match is bounded to avoid pairing it with a distant,
    unrelated cue.
    """
    if mark.slot is not None or mark.name:
        return float("inf")
    return UNNAMED_MATCH_SECONDS


def _compare_marks(
    expected: tuple[PositionMark, ...], actual: tuple[PositionMark, ...]
) -> list[tuple[str, str, str]]:
    """Compare marks one-to-one by identity key and nearest start time."""
    results: list[tuple[str, str, str]] = []
    keys = [_identity_key(mark) for mark in actual]
    groups = [[j for j, key in enumerate(keys) if key == _identity_key(want)] for want in expected]
    pairs = _pair_nearest(
        [mark.start_seconds for mark in expected],
        [mark.start_seconds for mark in actual],
        groups,
        [_match_tolerance(want) for want in expected],
    )
    for index, want in enumerate(expected):
        item = _mark_label(want)
        if index not in pairs:
            results.append((item, "missing", ""))
        else:
            results.append((item, *_compare_mark(want, actual[pairs[index]])))

    leftover = [j for j in range(len(actual)) if j not in set(pairs.values())]
    group_of: dict[int, int] = {}
    for j in leftover:
        got = actual[j]
        candidates = [i for i, want in enumerate(expected) if _identity_key(want) == keys[j]]
        if not candidates:
            continue
        best = min(candidates, key=lambda i: abs(expected[i].start_seconds - got.start_seconds))
        is_hot = _identity_key(expected[best])[0] == "hot"
        close_enough = abs(expected[best].start_seconds - got.start_seconds) <= ROUNDED_SECONDS
        if is_hot or close_enough:
            group_of[j] = best

    counts = Counter(group_of.values())
    reported: set[int] = set()
    for j in leftover:
        if j in group_of:
            expected_index = group_of[j]
            if expected_index in reported:
                continue
            reported.add(expected_index)
            item = _mark_label(expected[expected_index])
            count = counts[expected_index]
            word = "copy" if count == 1 else "copies"
            results.append((item, "duplicated", f"{count} extra {word}"))
        else:
            mark = actual[j]
            detail = f"{mark.kind} at {mark.start_seconds:.3f} s"
            results.append((_mark_label(mark), "extra", detail))
    return results


def _compare_mark(want: PositionMark, got: PositionMark) -> tuple[str, str]:
    differences = []
    if got.name != want.name:
        differences.append(f"name {got.name!r}")
    if got.kind != want.kind:
        differences.append(f"kind {got.kind}")
    if got.colour != want.colour:
        differences.append(f"colour {got.colour}")
    if (want.end_seconds is None) != (got.end_seconds is None) or (
        want.end_seconds is not None and abs(want.end_seconds - got.end_seconds) > ROUNDED_SECONDS
    ):
        differences.append(f"end {got.end_seconds:.3f}" if got.end_seconds is not None else "end")
    timing = _timing(want.start_seconds, got.start_seconds)
    if timing == "changed":
        differences.append(f"start {got.start_seconds:.3f}")
    if differences:
        return "changed", ", ".join(differences)
    return timing, _delta(want.start_seconds, got.start_seconds)


def _mark_label(mark: PositionMark) -> str:
    if mark.slot is not None:
        return f"hot {_SLOT_NAMES[mark.slot]}"
    return f"memory {mark.name or format(mark.start_seconds, '.3f')}"


def _timing(expected: float, actual: float) -> str:
    difference = abs(expected - actual)
    if difference <= EXACT_SECONDS:
        return "kept"
    return "rounded" if difference <= ROUNDED_SECONDS else "changed"


def _delta(expected: float, actual: float) -> str:
    return f"{(actual - expected) * 1000:+.1f} ms"


def _tempo_text(marker: TempoMarker) -> str:
    return (
        f"{marker.bpm:.2f} BPM at {marker.start_seconds:.3f} s, "
        f"{marker.meter} beat {marker.beat_in_bar}"
    )


def _location_key(track: RekordboxTrack) -> str:
    path = track.path
    return os.path.normcase(os.path.normpath(str(path))) if path is not None else track.location


def _finding(track: str, item: str, result: str, detail: str) -> dict[str, str]:
    return {"track": track, "item": item, "result": result, "detail": detail}
