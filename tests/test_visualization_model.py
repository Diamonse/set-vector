"""The data embedded in a report is faithful, compact, and JSON-safe."""

import base64
import json
from dataclasses import replace

import numpy as np
import pytest

from setvector.visualization import build_report_model
from setvector.visualization.model import parse_title


def decode(text, dtype):
    return np.frombuffer(base64.b64decode(text), dtype=dtype)


def test_series_round_trip_with_gaps(report_inputs):
    asset, bundle = report_inputs(frames=4, missing=(0, 2))
    model = build_report_model(asset, bundle)
    np.testing.assert_array_equal(
        decode(model.timestamps, "<f8"), bundle.measurements.rms.timestamps
    )
    by_name = {s.name: s for s in model.series}
    assert set(by_name) == {"rms", "bass_power_ratio", "spectral_centroid", "onset_strength"}
    centroid = decode(by_name["spectral_centroid"].values, "<f4")
    assert np.isnan(centroid[0]) and np.isnan(centroid[2])
    assert centroid[1] == pytest.approx(1100.0)
    assert by_name["rms"].unit == "linear_amplitude"


def test_summary_medians_bands_and_bars(report_inputs):
    asset, bundle = report_inputs(frames=4)
    summary = build_report_model(asset, bundle).summary
    assert summary.bass_median == pytest.approx(0.15)
    assert summary.bass_band == "Light"
    assert summary.centroid_median == pytest.approx(1150.0)
    assert summary.brightness_band == "Dark"
    decoded_duration = (4 * 22_050 + 7) / 44_100
    assert summary.bar_estimate == round(decoded_duration * 120 / 240)
    assert "not a calibrated judgment" in summary.bass_tip


@pytest.mark.parametrize(
    "median, band", [(0.29, "Light"), (0.3, "Moderate"), (0.59, "Moderate"), (0.6, "Heavy")]
)
def test_bass_band_edges(median, band):
    from setvector.visualization.model import BASS_BANDS, band_for

    assert band_for(median, BASS_BANDS) == band


def test_silence_and_missing_tempo_have_no_summary_values(report_inputs):
    asset, bundle = report_inputs(frames=3, missing=(0, 1, 2), beat_frames=())
    model = build_report_model(asset, bundle)
    assert model.tempo_bpm is None
    assert model.beats == ()
    assert model.summary.bass_median is None
    assert model.summary.bass_band is None
    assert model.summary.brightness_band is None
    assert model.summary.bar_estimate is None


def test_empty_series_are_supported(report_inputs):
    asset, bundle = report_inputs(frames=0, beat_frames=(), warnings=("too short",))
    model = build_report_model(asset, bundle)
    assert decode(model.timestamps, "<f8").size == 0
    assert model.warnings == ("too short",)


def test_model_is_strict_json(report_inputs):
    asset, bundle = report_inputs(frames=4, missing=(1,))
    data = build_report_model(asset, bundle).to_dict()
    text = json.dumps(data, allow_nan=False)
    assert json.loads(text)["downbeats"] == []
    assert data["feature_id"] == bundle.feature_id


def test_provenance_facts_and_format_line(report_inputs):
    asset, bundle = report_inputs(sample_rate=44_100, channels=2)
    model = build_report_model(asset, bundle)
    facts = dict(model.facts)
    assert facts["Feature ID"] == bundle.feature_id
    assert facts["Frame / hop"] == "22,050 / 22,050 samples"
    assert facts["Channels"] == "Mixed to mono"
    assert "librosa 0.11.0" in facts["Libraries"]
    assert model.format_line == "MP3 · 44.1 kHz · stereo"
    assert model.beats == (bundle.measurements.beats[0].seconds,)


@pytest.mark.parametrize(
    "stem, expected",
    [
        ("Artist - Title", ("Title", "Artist")),
        ("A - B - C", ("B - C", "A")),
        ("Solo Track", ("Solo Track", None)),
        (" - Title", (" - Title", None)),
        ("トラック - 名前", ("名前", "トラック")),
    ],
)
def test_parse_title(tmp_path, stem, expected):
    assert parse_title(str(tmp_path / f"{stem}.mp3")) == expected


def test_duration_comes_from_decoded_audio_not_the_header_estimate(report_inputs):
    asset, bundle = report_inputs(frames=4)
    model = build_report_model(asset, bundle)
    assert model.duration_seconds == pytest.approx((4 * 22_050 + 7) / 44_100)
    assert model.duration_seconds != pytest.approx(asset.duration_seconds)

    empty_asset, empty_bundle = report_inputs(frames=0, beat_frames=())
    empty_model = build_report_model(empty_asset, empty_bundle)
    assert empty_model.duration_seconds == pytest.approx(7 / 44_100)
    assert empty_model.duration_seconds != pytest.approx(empty_asset.duration_seconds)


def test_mismatched_asset_is_rejected(report_inputs):
    asset, bundle = report_inputs()
    with pytest.raises(ValueError, match="asset_id"):
        build_report_model(replace(asset, asset_id="b" * 64), bundle)
