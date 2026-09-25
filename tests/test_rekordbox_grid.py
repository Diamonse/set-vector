"""Rekordbox tempo markers expand to beats, and SetVector grids convert to markers."""

import pytest

from setvector.rekordbox import TempoMarker, expand_tempo


def test_single_marker_fills_to_the_end_with_bar_positions():
    beats, positions = expand_tempo((TempoMarker(0.5, 120.0, "4/4", 3),), 3.0)
    assert beats == pytest.approx((0.5, 1.0, 1.5, 2.0, 2.5))
    assert positions == (3, 4, 1, 2, 3)


def test_a_later_marker_resets_timing_and_bar_phase():
    markers = (TempoMarker(0.0, 120.0, "4/4", 1), TempoMarker(2.0, 120.0, "4/4", 3))
    beats, positions = expand_tempo(markers, 3.0)
    assert beats == pytest.approx((0.0, 0.5, 1.0, 1.5, 2.0, 2.5))
    assert positions == (1, 2, 3, 4, 3, 4)


def test_a_rounded_anchor_does_not_create_a_duplicate_beat():
    markers = (TempoMarker(0.0, 120.0, "4/4", 1), TempoMarker(2.003, 120.0, "4/4", 1))
    beats, positions = expand_tempo(markers, 2.6)
    assert beats == pytest.approx((0.0, 0.5, 1.0, 1.5, 2.003, 2.503))
    assert positions == (1, 2, 3, 4, 1, 2)


def test_a_marker_inside_the_guard_of_its_successor_contributes_no_beats():
    markers = (
        TempoMarker(0.0, 120.0, "4/4", 1),
        TempoMarker(1.0, 120.0, "4/4", 1),
        TempoMarker(1.05, 120.0, "4/4", 1),
    )
    beats, positions = expand_tempo(markers, 2.0)
    assert beats == pytest.approx((0.0, 0.5, 1.05, 1.55))
    assert positions == (1, 2, 1, 2)


@pytest.mark.parametrize(
    ("first_bpm", "next_start", "next_bpm", "keeps_beat"),
    [
        (120.0, 1.13, 120.0, True),
        (120.0, 1.11, 120.0, False),
        (60.0, 1.03, 600.0, True),
    ],
)
def test_the_guard_before_the_next_marker(first_bpm, next_start, next_bpm, keeps_beat):
    markers = (
        TempoMarker(0.0, first_bpm, "4/4", 1),
        TempoMarker(next_start, next_bpm, "4/4", 1),
    )
    beats, _ = expand_tempo(markers, next_start)
    assert any(beat == pytest.approx(1.0) for beat in beats) is keeps_beat


def test_markers_are_sorted_and_markers_past_the_end_are_ignored():
    markers = (TempoMarker(10.0, 120.0, "4/4", 1), TempoMarker(0.0, 120.0, "4/4", 1))
    beats, _ = expand_tempo(markers, 1.2)
    assert beats == pytest.approx((0.0, 0.5, 1.0))


def test_three_four_meter_cycles_three_positions():
    _, positions = expand_tempo((TempoMarker(0.0, 90.0, "3/4", 2),), 4.0)
    assert positions == (2, 3, 1, 2, 3, 1)


def test_no_markers_give_no_beats():
    assert expand_tempo((), 10.0) == ((), ())


def test_an_absurd_marker_is_rejected():
    with pytest.raises(ValueError, match=r"at 0\.0 s \(10000000\.0 BPM\).*more than"):
        expand_tempo((TempoMarker(0.0, 1e7, "4/4", 1),), 10.0)


@pytest.mark.parametrize("duration", [float("nan"), float("inf"), float("-inf")])
def test_a_nonfinite_duration_is_rejected(duration):
    with pytest.raises(ValueError, match="duration_seconds"):
        expand_tempo((TempoMarker(0.0, 120.0, "4/4", 1),), duration)
