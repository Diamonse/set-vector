"""Strict validation and round trips of rhythm analyses."""

from dataclasses import replace

import pytest

from setvector.domain import CandidateQuality, GridSegment, RhythmAnalysis
from setvector.storage import compute_rhythm_id


def test_round_trip_and_downbeats(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    assert RhythmAnalysis.from_dict(rhythm.to_dict()) == rhythm
    assert rhythm.downbeats == (rhythm.beats[0], rhythm.beats[4])
    assert rhythm.tempo_bpm == 120.0


def test_grid_segment_times_are_evenly_spaced():
    segment = GridSegment(start_seconds=1.0, bpm=120.0, beat_count=3, first_bar_position=2)
    assert segment.times() == (1.0, 1.5, 2.0)


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"source": "rekordbox"}, "source"),
        ({"reliable": False}, "reliable"),
        ({"tempo_bpm": 121.0}, "tempo_bpm"),
        ({"bar_positions": (1, 2, None, 4, 1, 2, 3, 4)}, "bar_positions"),
        ({"bar_positions": (1, 2, 3)}, "bar_positions"),
        ({"bar_positions": (0, 2, 3, 4, 1, 2, 3, 4)}, "bar_positions"),
        ({"beats": (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.1)}, "grid_segments"),
        ({"detected_beats": (1.0, 0.5)}, "detected_beats"),
        ({"quality": {"other": CandidateQuality(1, None, None, 0, None, None)}}, "quality"),
        ({"reasons": ("",)}, "reasons"),
        ({"asset_id": "A" * 64}, "asset_id"),
    ],
)
def test_invalid_rhythm_is_rejected(report_inputs, rhythm_factory, changes, message):
    _, bundle = report_inputs()
    with pytest.raises(ValueError, match=message):
        replace(rhythm_factory(bundle), **changes)


def test_first_bar_position_must_match_the_segment_start(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    with pytest.raises(ValueError, match="first_bar_position"):
        replace(rhythm, grid_segments=(GridSegment(0.5, 120.0, 8, 2),))


def test_fallback_has_no_bar_positions(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    fallback = rhythm_factory(bundle, source="setvector_fallback")
    assert fallback.downbeats == ()
    with pytest.raises(ValueError, match="setvector_fallback"):
        replace(
            fallback,
            grid_segments=(GridSegment(0.5, 120.0, 8, 1),),
            bar_positions=tuple((i % 4) + 1 for i in range(8)),
        )


def test_none_source_has_no_grid(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    empty = rhythm_factory(bundle, source="none")
    assert RhythmAnalysis.from_dict(empty.to_dict()) == empty
    with pytest.raises(ValueError, match="none"):
        replace(empty, tempo_bpm=120.0)


def test_from_dict_rejects_unknown_and_missing_fields(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    data = rhythm_factory(bundle).to_dict()
    with pytest.raises(ValueError, match="unknown"):
        RhythmAnalysis.from_dict({**data, "extra": 1})
    del data["beats"]
    with pytest.raises(ValueError, match="missing"):
        RhythmAnalysis.from_dict(data)


def test_rhythm_id_depends_on_feature_and_every_extractor_input(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    base = compute_rhythm_id(bundle.feature_id, rhythm.extractor)
    assert base == rhythm.rhythm_id
    assert compute_rhythm_id("b" * 64, rhythm.extractor) != base
    changed = replace(rhythm.extractor, parameters={"checkpoint": "final1"})
    assert compute_rhythm_id(bundle.feature_id, changed) != base


def test_tempo_bpm_is_coerced_to_float(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    updated = replace(rhythm, tempo_bpm=120)
    assert updated.tempo_bpm == 120.0
    assert type(updated.tempo_bpm) is float


def test_tempo_bpm_rejects_bool(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 1.0, 8, 1),))
    with pytest.raises(ValueError, match="tempo_bpm"):
        replace(rhythm, tempo_bpm=True)


def test_quality_rejects_non_string_keys(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    with pytest.raises(ValueError, match="quality"):
        replace(
            rhythm,
            quality={
                5: CandidateQuality(1, None, None, 0, None, None),
                "beat_this": CandidateQuality(1, None, None, 0, None, None),
            },
        )
