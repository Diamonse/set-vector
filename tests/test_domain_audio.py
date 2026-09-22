"""Audio asset contract boundaries."""

from pathlib import Path

import pytest

from setvector.domain import AudioAsset


def valid_asset(tmp_path: Path) -> AudioAsset:
    return AudioAsset(
        asset_id="a" * 64,
        observed_path=str((tmp_path / "track.wav").resolve()),
        byte_size=44,
        duration_seconds=1.0,
        native_sample_rate=8_000,
        channels=1,
        format="WAV",
        subtype="PCM_16",
    )


def test_audio_asset_round_trip_is_strict(tmp_path):
    asset = valid_asset(tmp_path)

    assert AudioAsset.from_dict(asset.to_dict()) == asset
    with pytest.raises(ValueError, match="unknown fields"):
        AudioAsset.from_dict({**asset.to_dict(), "extra": True})


@pytest.mark.parametrize("asset_id", ["short", "G" * 64])
def test_audio_asset_requires_sha256_hex(tmp_path, asset_id):
    with pytest.raises(ValueError, match="asset_id"):
        AudioAsset(**{**valid_asset(tmp_path).to_dict(), "asset_id": asset_id})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("byte_size", True),
        ("byte_size", -1),
        ("duration_seconds", float("nan")),
        ("duration_seconds", float("inf")),
        ("native_sample_rate", 0),
        ("channels", False),
        ("format", ""),
        ("subtype", "  "),
    ],
)
def test_audio_asset_rejects_invalid_metadata(tmp_path, field, value):
    with pytest.raises(ValueError, match=field):
        AudioAsset(**{**valid_asset(tmp_path).to_dict(), field: value})
