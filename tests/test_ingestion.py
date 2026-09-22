"""Content-identified inspection and explicit decoding of local audio."""

import hashlib
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from setvector.domain import AnalysisConfig, DecodeError, InputError, UnsupportedAudioError
from setvector.ingestion import DecodedAudio, decode_audio, inspect_audio


def native_config(channel_policy="mono"):
    return AnalysisConfig(
        sample_rate=None, frame_length=400, hop_length=200, channel_policy=channel_policy
    )


def preserve_config():
    return native_config("preserve")


def resampled_preserve_config():
    return AnalysisConfig(
        sample_rate=4_000, frame_length=400, hop_length=200, channel_policy="preserve"
    )


def write_tone(path: Path, channels: int, frames: int = 800, sample_rate: int = 8_000) -> Path:
    t = np.arange(frames) / sample_rate
    columns = [0.5 * np.sin(2 * np.pi * (220 * (i + 1)) * t) for i in range(channels)]
    samples = np.column_stack(columns).astype(np.float32)
    sf.write(path, samples, sample_rate, format="WAV", subtype="FLOAT")
    return path


def write_stereo_tone(path: Path, frames: int, sample_rate: int) -> Path:
    return write_tone(path, channels=2, frames=frames, sample_rate=sample_rate)


def test_inspect_uses_content_hash_and_decoder_metadata(tmp_path):
    path = tmp_path / "song with spaces.unknown"
    sf.write(path, np.zeros((8_000, 2), dtype=np.float32), 8_000, format="WAV")
    asset = inspect_audio(path)
    assert asset.asset_id == hashlib.sha256(path.read_bytes()).hexdigest()
    assert asset.observed_path == str(path.resolve())
    assert asset.byte_size == path.stat().st_size
    assert asset.channels == 2
    assert asset.native_sample_rate == 8_000
    assert asset.duration_seconds == pytest.approx(1.0)
    assert asset.format == "WAV"
    assert asset.subtype == "PCM_16"


def test_inspect_accepts_relative_and_unicode_paths(tmp_path, monkeypatch):
    path = write_tone(tmp_path / "trâck ドロップ.wav", channels=1)
    monkeypatch.chdir(tmp_path)
    asset = inspect_audio(path.name)
    assert asset.observed_path == str(path.resolve())
    decoded = decode_audio(path.name, asset, native_config())
    assert decoded.samples.shape == (1, 800)


def test_decode_mono_averages_before_resampling(tmp_path):
    path = tmp_path / "anti phase.wav"
    stereo = np.column_stack([np.ones(800), -np.ones(800)]).astype(np.float32)
    sf.write(path, stereo, 8_000, subtype="FLOAT")
    asset = inspect_audio(path)
    decoded = decode_audio(
        path,
        asset,
        AnalysisConfig(sample_rate=4_000, frame_length=400, hop_length=200, channel_policy="mono"),
    )
    assert decoded.samples.shape == (1, 400)
    assert np.max(np.abs(decoded.samples)) < 1e-6
    assert decoded.sample_rate == 4_000
    assert decoded.samples.dtype == np.float32
    assert not decoded.samples.flags.writeable


def test_decode_preserves_channel_axis_while_resampling(tmp_path):
    path = write_stereo_tone(tmp_path / "stereo.wav", frames=800, sample_rate=8_000)
    asset = inspect_audio(path)
    decoded = decode_audio(path, asset, resampled_preserve_config())
    assert decoded.samples.shape == (2, 400)
    assert decoded.sample_rate == 4_000
    assert not np.allclose(decoded.samples[0], decoded.samples[1])


def test_decode_native_rate_preserve_keeps_samples_exactly(tmp_path):
    path = write_stereo_tone(tmp_path / "stereo.wav", frames=800, sample_rate=8_000)
    source, _ = sf.read(path, dtype="float32", always_2d=True)
    decoded = decode_audio(path, inspect_audio(path), preserve_config())
    assert decoded.sample_rate == 8_000
    np.testing.assert_array_equal(decoded.samples, source.T)


def test_decode_does_not_normalize_levels(tmp_path):
    path = tmp_path / "quiet.wav"
    sf.write(path, np.full((800, 1), 0.01, dtype=np.float32), 8_000, subtype="FLOAT")
    decoded = decode_audio(path, inspect_audio(path), native_config())
    np.testing.assert_allclose(decoded.samples, 0.01)


def test_configured_rate_equal_to_native_does_not_resample(tmp_path):
    path = write_tone(tmp_path / "tone.wav", channels=1)
    config = AnalysisConfig(
        sample_rate=8_000, frame_length=400, hop_length=200, channel_policy="mono"
    )
    source, _ = sf.read(path, dtype="float32", always_2d=True)
    decoded = decode_audio(path, inspect_audio(path), config)
    np.testing.assert_array_equal(decoded.samples, source.T)


def test_audio_header_with_arbitrary_extension_is_accepted(tmp_path):
    path = write_tone(tmp_path / "track.txt", channels=1)
    asset = inspect_audio(path)
    assert asset.format == "WAV"


def test_missing_empty_and_corrupt_inputs_fail_clearly(tmp_path):
    with pytest.raises(InputError, match="does not exist"):
        inspect_audio(tmp_path / "missing.wav")
    empty = tmp_path / "empty.wav"
    empty.touch()
    with pytest.raises(InputError, match="empty"):
        inspect_audio(empty)
    corrupt = tmp_path / "corrupt.wav"
    corrupt.write_bytes(b"not audio")
    with pytest.raises(UnsupportedAudioError, match="unsupported"):
        inspect_audio(corrupt)


def test_directory_is_rejected(tmp_path):
    with pytest.raises(InputError, match="not a file"):
        inspect_audio(tmp_path)


def test_decode_rejects_file_changed_after_inspection(tmp_path):
    path = write_tone(tmp_path / "track.wav", channels=2)
    asset = inspect_audio(path)
    path.write_bytes(path.read_bytes() + b"changed")
    with pytest.raises(DecodeError, match="changed"):
        decode_audio(path, asset, preserve_config())


def test_decode_rejects_mutation_during_read(monkeypatch, tmp_path):
    path = write_tone(tmp_path / "track.wav", channels=1)
    asset = inspect_audio(path)
    real_read = sf.read

    def mutating_read(*args, **kwargs):
        result = real_read(*args, **kwargs)
        path.write_bytes(path.read_bytes() + b"changed during decode")
        return result

    monkeypatch.setattr(sf, "read", mutating_read)
    with pytest.raises(DecodeError, match="changed"):
        decode_audio(path, asset, native_config())


def test_decoder_failure_becomes_decode_error(monkeypatch, tmp_path):
    path = write_tone(tmp_path / "track.wav", channels=1)
    asset = inspect_audio(path)

    def failing_read(*args, **kwargs):
        raise sf.LibsndfileError(1, "simulated")

    monkeypatch.setattr(sf, "read", failing_read)
    with pytest.raises(DecodeError, match="decode"):
        decode_audio(path, asset, native_config())


def test_zero_length_audio_is_rejected_when_decoding(tmp_path):
    path = tmp_path / "no frames.wav"
    sf.write(path, np.zeros((0, 1), dtype=np.float32), 8_000, subtype="FLOAT")
    asset = inspect_audio(path)
    with pytest.raises(DecodeError, match="no audio samples"):
        decode_audio(path, asset, native_config())


def test_decoded_audio_copies_and_freezes_samples(tmp_path):
    path = write_tone(tmp_path / "track.wav", channels=1)
    asset = inspect_audio(path)
    samples = np.zeros((1, 4), dtype=np.float64)
    decoded = DecodedAudio(asset=asset, samples=samples, sample_rate=8_000)
    samples[0, 0] = 1.0
    assert decoded.samples[0, 0] == 0.0
    assert decoded.samples.dtype == np.float32
    with pytest.raises(ValueError):
        decoded.samples[0, 0] = 2.0
    with pytest.raises(ValueError, match="channels, samples"):
        DecodedAudio(asset=asset, samples=np.zeros(4), sample_rate=8_000)
    with pytest.raises(ValueError, match="sample_rate"):
        DecodedAudio(asset=asset, samples=np.zeros((1, 4)), sample_rate=0)
