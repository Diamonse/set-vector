"""Browser-playable audio for reports, verified against the analyzed content."""

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile
import soxr

from setvector.domain import AudioAsset, DecodeError, InputError

from .audio import _resolve_file

_MP3_RATES = (8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000)


@dataclass(frozen=True, slots=True)
class PreviewAudio:
    """Encoded audio bytes and the MIME type a browser needs to play them."""

    mime_type: str
    data: bytes


def load_preview(path: str | Path, asset: AudioAsset) -> PreviewAudio:
    """Return playable audio for ``asset`` after proving ``path`` holds the same bytes.

    MP3 content is returned unchanged. Other formats are decoded from the verified
    bytes and encoded to MP3 in memory; the source file is never modified.
    """
    resolved = _resolve_file(path)
    try:
        data = resolved.read_bytes()
    except OSError as error:
        raise InputError(f"cannot read audio file {resolved}: {error}") from error
    if hashlib.sha256(data).hexdigest() != asset.asset_id:
        raise InputError(
            f"{resolved} is not the audio that was analyzed; "
            f"its content differs from asset {asset.asset_id}"
        )
    if asset.format == "MP3":
        return PreviewAudio("audio/mpeg", data)
    return PreviewAudio("audio/mpeg", _encode_mp3(data, resolved))


def _encode_mp3(data: bytes, source: Path) -> bytes:
    try:
        samples, rate = soundfile.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except (soundfile.SoundFileError, RuntimeError) as error:
        raise DecodeError(f"cannot decode audio file {source}: {error}") from error
    if samples.shape[1] > 2:
        samples = samples.mean(axis=1, keepdims=True, dtype=np.float32)
    target = rate if rate in _MP3_RATES else next((r for r in _MP3_RATES if r >= rate), 48_000)
    if target != rate:
        samples = soxr.resample(samples, rate, target, quality="HQ")
    buffer = io.BytesIO()
    try:
        soundfile.write(buffer, samples, target, format="MP3", subtype="MPEG_LAYER_III")
    except (soundfile.SoundFileError, RuntimeError, ValueError) as error:
        raise DecodeError(f"cannot encode an MP3 preview of {source}: {error}") from error
    return buffer.getvalue()
