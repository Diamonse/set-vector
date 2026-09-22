"""Scalar feature timing, missing observations, and schema boundaries."""

import json
from dataclasses import FrozenInstanceError

import pytest

from setvector.domain import FeatureSeries


@pytest.fixture
def series_data():
    return {
        "schema_version": 1,
        "name": "rms",
        "unit": "amplitude",
        "timestamps": [0.25, 0.75, 1.25],
        "values": [0.0, None, 0.5],
        "validity": [True, False, True],
        "window_starts": [0.0, 0.5, 1.0],
        "window_ends": [0.5, 1.0, 1.5],
    }


def test_json_round_trip_keeps_silence_distinct_from_missing_data(series_data):
    series = FeatureSeries.from_dict(series_data)
    decoded = json.loads(json.dumps(series.to_dict(), allow_nan=False))

    assert series.values == (0.0, None, 0.5)
    assert series.validity == (True, False, True)
    assert decoded == series_data
    assert FeatureSeries.from_dict(decoded) == series


def test_series_detaches_input_and_output_arrays(series_data):
    series = FeatureSeries.from_dict(series_data)
    exported = series.to_dict()
    for field in ("timestamps", "values", "validity", "window_starts", "window_ends"):
        series_data[field].clear()
        exported[field].clear()
        assert isinstance(getattr(series, field), tuple)
        assert len(getattr(series, field)) == 3
    with pytest.raises(FrozenInstanceError):
        series.name = "different"


def test_empty_series_is_valid_when_every_array_is_empty(series_data):
    for field in ("timestamps", "values", "validity", "window_starts", "window_ends"):
        series_data[field] = []

    assert FeatureSeries.from_dict(series_data).timestamps == ()


@pytest.mark.parametrize(
    "field", ["timestamps", "values", "validity", "window_starts", "window_ends"]
)
def test_array_lengths_must_agree(series_data, field):
    series_data[field].pop()

    with pytest.raises(ValueError, match="length"):
        FeatureSeries.from_dict(series_data)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 2),
        ("schema_version", True),
        ("schema_version", 1.0),
        ("name", ""),
        ("name", "  "),
        ("unit", ""),
        ("unit", None),
        ("timestamps", [0.25, 0.25, 1.25]),
        ("timestamps", [0.75, 0.25, 1.25]),
        ("timestamps", [-0.25, 0.75, 1.25]),
        ("timestamps", [float("nan"), 0.75, 1.25]),
        ("timestamps", [True, 0.75, 1.25]),
        ("values", [float("inf"), None, 0.5]),
        ("values", [float("nan"), None, 0.5]),
        ("values", [True, None, 0.5]),
        ("values", [[0.0], None, 0.5]),
        ("values", [None, None, 0.5]),
        ("values", [0.0, 0.0, 0.5]),
        ("validity", [1, False, True]),
        ("window_starts", [-0.1, 0.5, 1.0]),
        ("window_starts", [0.3, 0.5, 1.0]),
        ("window_ends", [0.2, 1.0, 1.5]),
        ("window_ends", [0.0, 1.0, 1.5]),
        ("window_ends", [float("inf"), 1.0, 1.5]),
        ("timestamps", "bad"),
        ("values", None),
    ],
)
def test_invalid_series_is_rejected_at_both_boundaries(series_data, field, value):
    invalid = {**series_data, field: value}

    with pytest.raises(ValueError):
        FeatureSeries.from_dict(invalid)
    with pytest.raises(ValueError):
        FeatureSeries(**invalid)


def test_reader_rejects_schema_drift(series_data):
    with pytest.raises(ValueError, match="dimensions"):
        FeatureSeries.from_dict({**series_data, "dimensions": 2})
    del series_data["window_starts"]
    with pytest.raises(ValueError, match="window_starts"):
        FeatureSeries.from_dict(series_data)


@pytest.mark.parametrize("data", [None, [], "{}"])
def test_series_reader_requires_an_object(data):
    with pytest.raises(ValueError, match="object"):
        FeatureSeries.from_dict(data)
