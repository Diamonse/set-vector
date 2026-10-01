"""Rekordbox tempo markers expand to beats, and SetVector grids convert to markers."""

import random
from dataclasses import replace

import pytest

from setvector.domain import CandidateQuality, GridSegment
from setvector.rekordbox import TempoMarker, expand_tempo, tempo_markers_for


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


def assert_expands_to(markers, rhythm):
    beats, positions = expand_tempo(markers, rhythm.beats[-1] + 0.1)
    assert len(beats) == len(rhythm.beats)
    assert max(abs(a - b) for a, b in zip(beats, rhythm.beats, strict=True)) <= 0.005
    assert positions == rhythm.bar_positions


def test_each_grid_segment_becomes_a_marker(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(
        bundle, segments=(GridSegment(0.5, 120.0, 8, 1), GridSegment(4.5, 128.0, 8, 1))
    )
    markers = tempo_markers_for(rhythm)
    assert markers == (TempoMarker(0.5, 120.0, "4/4", 1), TempoMarker(4.5, 128.0, "4/4", 1))
    assert_expands_to(markers, rhythm)


def test_markers_are_added_where_bpm_rounding_would_drift(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.2504, 124.004, 800, 1),))
    markers = tempo_markers_for(rhythm)
    assert len(markers) > 1
    assert all(marker.bpm == 124.0 for marker in markers)
    assert markers[0].start_seconds == 0.25
    assert_expands_to(markers, rhythm)


def test_a_phase_change_inside_a_segment_starts_a_new_marker(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 12, 1),))
    shifted = replace(rhythm, bar_positions=(1, 2, 3, 4, 1, 2, 1, 2, 3, 4, 1, 2))
    markers = tempo_markers_for(shifted)
    assert markers == (TempoMarker(0.5, 120.0, "4/4", 1), TempoMarker(3.5, 120.0, "4/4", 1))
    assert_expands_to(markers, shifted)


def test_three_beat_bars_write_three_four(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 9, 1),))
    waltz = replace(
        rhythm,
        bar_positions=tuple(i % 3 + 1 for i in range(9)),
        quality={"beat_this": CandidateQuality(9, 0.01, 1.0, 1, 3, 1.0)},
    )
    markers = tempo_markers_for(waltz)
    assert markers == (TempoMarker(0.5, 120.0, "3/4", 1),)
    assert_expands_to(markers, waltz)


def test_bar_positions_beyond_the_meter_are_rejected(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 8, 1),))
    long_bar = replace(rhythm, bar_positions=(1, 2, 3, 4, 5, 1, 2, 3))
    with pytest.raises(ValueError, match="meter"):
        tempo_markers_for(long_bar)


@pytest.mark.parametrize("source", ["setvector_fallback", "none"])
def test_only_reliable_beat_this_grids_convert(report_inputs, rhythm_factory, source):
    _, bundle = report_inputs()
    with pytest.raises(ValueError, match="beat_this"):
        tempo_markers_for(rhythm_factory(bundle, source=source))


def test_a_bridging_marker_is_added_across_a_wide_segment_gap(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(
        bundle,
        segments=(
            GridSegment(0.5, 120.0, 8, 1),
            GridSegment(0.5 + 7 * 0.5 + 0.7, 128.0, 8, 1),
        ),
    )
    markers = tempo_markers_for(rhythm)
    assert_expands_to(markers, rhythm)


def test_a_segment_starting_mid_bar_converts_correctly(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(
        bundle, segments=(GridSegment(0.5, 120.0, 8, 1), GridSegment(4.5, 128.0, 8, 1))
    )
    shifted = replace(
        rhythm,
        grid_segments=(GridSegment(0.5, 120.0, 8, 1), GridSegment(4.5, 128.0, 8, 3)),
        bar_positions=(1, 2, 3, 4, 1, 2, 3, 4, 3, 4, 1, 2, 3, 4, 1, 2),
    )
    markers = tempo_markers_for(shifted)
    assert_expands_to(markers, shifted)


def _random_beat_this_rhythm(rng, bundle, rhythm_factory):
    """Build a valid multi-segment beat_this RhythmAnalysis with randomized grids."""
    base = rhythm_factory(bundle)
    bar_length = rng.choice((3, 4))
    segments: list[GridSegment] = []
    positions: list[int] = []
    position = rng.randint(1, bar_length)
    last_beat_time = None
    previous_period = None
    for _ in range(rng.randint(1, 3)):
        bpm = rng.uniform(60.0, 180.0)
        beat_count = rng.randint(32, 400)
        if last_beat_time is None:
            start = rng.uniform(0.0, 2.0)
        else:
            start = last_beat_time + rng.uniform(0.5, 1.5) * previous_period
        segment = GridSegment(start, bpm, beat_count, position)
        segments.append(segment)
        for _ in range(beat_count):
            positions.append(position)
            position = (
                rng.randint(1, bar_length) if rng.random() < 0.05 else position % bar_length + 1
            )
        last_beat_time = segment.times()[-1]
        previous_period = 60.0 / bpm
    beats = tuple(t for segment in segments for t in segment.times())
    quality = {"beat_this": CandidateQuality(len(beats), 0.01, 1.0, len(segments), bar_length, 1.0)}
    return replace(
        base,
        grid_segments=tuple(segments),
        beats=beats,
        bar_positions=tuple(positions),
        detected_beats=beats,
        tempo_bpm=max(segments, key=lambda segment: segment.beat_count).bpm,
        quality=quality,
        reliable=True,
        reasons=(),
    )


def test_round_trip_property_on_randomized_multi_segment_grids(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rng = random.Random(7)
    for _ in range(200):
        rhythm = _random_beat_this_rhythm(rng, bundle, rhythm_factory)
        markers = tempo_markers_for(rhythm)
        assert_expands_to(markers, rhythm)
