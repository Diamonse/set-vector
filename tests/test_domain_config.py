"""Configuration validation and reproducible cache identity."""

import json

import pytest

from setvector.domain import AnalysisConfig


@pytest.fixture
def config_data():
    return {
        "schema_version": 1,
        "sample_rate": 44100,
        "frame_length": 2048,
        "hop_length": 512,
        "channel_policy": "mono",
    }


def test_config_round_trip_preserves_explicit_signal_settings(config_data):
    config_data["sample_rate"] = None
    config_data["channel_policy"] = "preserve"
    config = AnalysisConfig.from_dict(config_data)

    assert config.sample_rate is None
    assert config.channel_policy == "preserve"
    assert json.loads(json.dumps(config.to_dict())) == config_data
    assert AnalysisConfig.from_dict(config.to_dict()) == config


def test_identity_is_independent_of_mapping_order(config_data):
    config = AnalysisConfig.from_dict(config_data)
    reordered = AnalysisConfig.from_dict(dict(reversed(config_data.items())))

    assert reordered.config_id == config.config_id
    assert config.config_id == "a3196f23a162d13648e452a40d13a51ea7752d49abf23354e14110d4aa8db4ab"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sample_rate", None),
        ("sample_rate", 48000),
        ("frame_length", 4096),
        ("hop_length", 1024),
        ("channel_policy", "preserve"),
    ],
)
def test_every_signal_setting_changes_config_identity(config_data, field, value):
    original = AnalysisConfig.from_dict(config_data)
    changed = AnalysisConfig.from_dict({**config_data, field: value})

    assert changed.config_id != original.config_id


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 2),
        ("schema_version", True),
        ("schema_version", 1.0),
        ("sample_rate", 0),
        ("sample_rate", -1),
        ("sample_rate", True),
        ("sample_rate", 44100.0),
        ("frame_length", 0),
        ("frame_length", False),
        ("frame_length", 2048.0),
        ("hop_length", 0),
        ("hop_length", True),
        ("hop_length", 2049),
        ("channel_policy", "stereo"),
        ("channel_policy", None),
    ],
)
def test_invalid_config_is_rejected_at_both_boundaries(config_data, field, value):
    invalid = {**config_data, field: value}

    with pytest.raises(ValueError, match=field):
        AnalysisConfig.from_dict(invalid)
    with pytest.raises(ValueError, match=field):
        AnalysisConfig(**invalid)


@pytest.mark.parametrize(
    "field", ["schema_version", "sample_rate", "frame_length", "hop_length", "channel_policy"]
)
def test_config_reader_never_invents_missing_settings(config_data, field):
    del config_data[field]

    with pytest.raises(ValueError, match=field):
        AnalysisConfig.from_dict(config_data)


def test_config_reader_rejects_unknown_settings(config_data):
    with pytest.raises(ValueError, match="normalize"):
        AnalysisConfig.from_dict({**config_data, "normalize": True})


@pytest.mark.parametrize("data", [None, [], "{}"])
def test_config_reader_requires_an_object(data):
    with pytest.raises(ValueError, match="object"):
        AnalysisConfig.from_dict(data)


def test_config_export_cannot_mutate_identity(config_data):
    config = AnalysisConfig.from_dict(config_data)
    identity = config.config_id
    config_data["sample_rate"] = 8000
    exported = config.to_dict()
    exported["sample_rate"] = 16000

    assert config.sample_rate == 44100
    assert config.config_id == identity
