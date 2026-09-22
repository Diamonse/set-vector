"""Browser-playable previews of exactly the analyzed audio."""

import io

import numpy as np
import pytest
import soundfile as sf

from setvector.domain import DecodeError, InputError
from setvector.ingestion import PreviewAudio, inspect_audio, load_preview


def tone(rate, seconds, channels):
    t = np.arange(int(rate * seconds)) / rate
    column = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    return np.repeat(column[:, None], channels, axis=1)


def test_mp3_bytes_pass_through_unchanged(tmp_path):
    path = tmp_path / "track.mp3"
    sf.write(path, tone(44_100, 1.0, 2), 44_100, format="MP3", subtype="MPEG_LAYER_III")
    preview = load_preview(path, inspect_audio(path))
    assert preview == PreviewAudio("audio/mpeg", path.read_bytes())


@pytest.mark.parametrize(
    "rate, channels, expected_rate, expected_channels",
    [(8_000, 1, 8_000, 1), (44_100, 2, 44_100, 2), (96_000, 2, 48_000, 2), (48_000, 3, 48_000, 1)],
)
def test_other_formats_become_mp3_of_the_same_length(
    tmp_path, rate, channels, expected_rate, expected_channels
):
    path = tmp_path / "track.wav"
    sf.write(path, tone(rate, 1.0, channels), rate, subtype="PCM_16")
    source_bytes = path.read_bytes()
    preview = load_preview(path, inspect_audio(path))
    assert preview.mime_type == "audio/mpeg"
    decoded, decoded_rate = sf.read(io.BytesIO(preview.data), always_2d=True)
    assert decoded_rate == expected_rate
    assert decoded.shape[1] == expected_channels
    assert decoded.shape[0] / decoded_rate == pytest.approx(1.0, abs=1152 / expected_rate)
    assert path.read_bytes() == source_bytes


def test_missing_and_mismatched_files_are_input_errors(tmp_path):
    path = tmp_path / "track.wav"
    sf.write(path, tone(8_000, 0.5, 1), 8_000)
    asset = inspect_audio(path)
    with pytest.raises(InputError, match="does not exist"):
        load_preview(tmp_path / "moved.wav", asset)
    other = tmp_path / "other.wav"
    sf.write(other, tone(8_000, 0.6, 1), 8_000)
    with pytest.raises(InputError, match="not the audio that was analyzed"):
        load_preview(other, asset)


def test_decoder_failure_is_a_decode_error(tmp_path, monkeypatch):
    path = tmp_path / "track.wav"
    sf.write(path, tone(8_000, 0.5, 1), 8_000)
    asset = inspect_audio(path)

    def failing_read(*args, **kwargs):
        raise sf.LibsndfileError(1, "simulated")

    monkeypatch.setattr(sf, "read", failing_read)
    with pytest.raises(DecodeError, match="decode"):
        load_preview(path, asset)
