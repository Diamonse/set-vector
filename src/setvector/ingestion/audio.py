"""Inspect and decode local audio without normalizing its levels."""

import hashlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile
import soxr

from setvector.domain import (
    AnalysisConfig,
    AudioAsset,
    DecodeError,
    InputError,
    UnsupportedAudioError,
)

_HASH_CHUNK_BYTES = 1 << 20


@dataclass(frozen=True, slots=True)
class DecodedAudio:
    """Read-only ``float32`` samples shaped ``(channels, samples)``."""

    asset: AudioAsset
    samples: np.ndarray
    sample_rate: int

    def __post_init__(self) -> None:
        if not isinstance(self.asset, AudioAsset):
            raise ValueError("asset must be AudioAsset")
        if type(self.sample_rate) is not int or self.sample_rate <= 0:
            raise ValueError("sample_rate must be a positive integer")
        samples = np.array(self.samples, dtype=np.float32, copy=True, order="C")
        if samples.ndim != 2 or samples.shape[0] < 1:
            raise ValueError("samples must have shape (channels, samples)")
        samples.setflags(write=False)
        object.__setattr__(self, "samples", samples)


def _resolve_file(path: str | Path) -> Path:
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise InputError(f"audio file does not exist: {resolved}")
    if not resolved.is_file():
        raise InputError(f"audio path is not a file: {resolved}")
    return resolved


def _content_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(_HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_audio(path: str | Path) -> AudioAsset:
    """Identify an audio file by content and read decoder-reported metadata."""
    resolved = _resolve_file(path)
    try:
        byte_size = resolved.stat().st_size
        if byte_size == 0:
            raise InputError(f"audio file is empty: {resolved}")
        asset_id = _content_hash(resolved)
    except OSError as error:
        raise InputError(f"cannot read audio file {resolved}: {error}") from error
    try:
        info = soundfile.info(str(resolved))
    except (soundfile.SoundFileError, RuntimeError) as error:
        raise UnsupportedAudioError(
            f"unsupported or unrecognized audio content: {resolved}"
        ) from error
    return AudioAsset(
        asset_id=asset_id,
        observed_path=str(resolved),
        byte_size=byte_size,
        duration_seconds=info.frames / info.samplerate,
        native_sample_rate=info.samplerate,
        channels=info.channels,
        format=info.format,
        subtype=info.subtype,
    )


def _require_unchanged(path: Path, asset: AudioAsset) -> None:
    try:
        current = _content_hash(path)
    except OSError as error:
        raise DecodeError(f"cannot read audio file {path}: {error}") from error
    if current != asset.asset_id:
        raise DecodeError(f"audio file changed since inspection: {path}")


def decode_audio(path: str | Path, asset: AudioAsset, config: AnalysisConfig) -> DecodedAudio:
    """Decode an inspected asset using the configuration's channel and rate policy."""
    resolved = _resolve_file(path)
    _require_unchanged(resolved, asset)
    try:
        samples, native_rate = soundfile.read(str(resolved), dtype="float32", always_2d=True)
    except (soundfile.SoundFileError, RuntimeError) as error:
        raise DecodeError(f"cannot decode audio file {resolved}: {error}") from error
    _require_unchanged(resolved, asset)
    if samples.shape[0] == 0:
        raise DecodeError(f"audio file contains no audio samples: {resolved}")
    if config.channel_policy == "mono":
        samples = samples.mean(axis=1, keepdims=True, dtype=np.float32)
    sample_rate = native_rate
    if config.sample_rate is not None and config.sample_rate != native_rate:
        samples = soxr.resample(samples, native_rate, config.sample_rate, quality="HQ")
        sample_rate = config.sample_rate
    return DecodedAudio(asset=asset, samples=samples.T, sample_rate=sample_rate)
