"""Baseline frame measurements on a common left-aligned grid.

Frames contain exactly ``frame_length`` samples and start every ``hop_length``
samples. Nothing is centered or padded; a final partial window is omitted and
counted. Frames are processed in bounded chunks so full-length tracks do not
materialize every windowed frame or spectrum at once.
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisError,
    AnalysisMeasurements,
    BeatPosition,
    FeatureSeries,
)
from setvector.ingestion import DecodedAudio

from .identity import BASS_CUTOFF_HZ

_FRAMES_PER_CHUNK = 256
_TEMPOGRAM_FRAMES_PER_CHUNK = 2_048


def _frame_count(sample_count: int, frame_length: int, hop_length: int) -> int:
    if sample_count < frame_length:
        return 0
    return 1 + (sample_count - frame_length) // hop_length


def _omitted_tail(sample_count: int, frame_count: int, frame_length: int, hop_length: int) -> int:
    if frame_count == 0:
        return sample_count
    return sample_count - ((frame_count - 1) * hop_length + frame_length)


def _check_consistency(decoded: DecodedAudio, config: AnalysisConfig) -> None:
    if config.sample_rate is not None and decoded.sample_rate != config.sample_rate:
        raise ValueError("decoded sample_rate does not match the configured sample_rate")
    if config.channel_policy == "mono" and decoded.samples.shape[0] != 1:
        raise ValueError("mono channel policy requires single-channel decoded audio")


def _series(name, unit, timing, values):
    timestamps, starts, ends = timing
    validity = tuple(value is not None for value in values)
    return FeatureSeries(
        name=name,
        unit=unit,
        timestamps=timestamps,
        values=tuple(values),
        validity=validity,
        window_starts=starts,
        window_ends=ends,
    )


def _ratio(numerator: np.ndarray, denominator: np.ndarray) -> list[float | None]:
    return [
        float(top / bottom) if bottom > 0 else None
        for top, bottom in zip(numerator, denominator, strict=True)
    ]


def _measure_frames(samples: np.ndarray, sample_rate: int, config: AnalysisConfig, frames: int):
    frame_length, hop_length = config.frame_length, config.hop_length
    windows = sliding_window_view(samples, frame_length, axis=1)
    hann = np.hanning(frame_length)
    frequencies = np.fft.rfftfreq(frame_length, d=1 / sample_rate)
    bass_bins = frequencies <= BASS_CUTOFF_HZ
    rms = np.empty(frames)
    weighted = np.empty(frames)
    magnitude_total = np.empty(frames)
    bass_power = np.empty(frames)
    total_power = np.empty(frames)
    flux = np.zeros(frames)
    previous = None
    for first in range(0, frames, _FRAMES_PER_CHUNK):
        last = min(first + _FRAMES_PER_CHUNK, frames)
        block = windows[:, first * hop_length : (last - 1) * hop_length + 1 : hop_length]
        block = block.astype(np.float64)
        rms[first:last] = np.sqrt(np.mean(np.square(block), axis=(0, 2)))
        spectrum = np.fft.rfft(block * hann, axis=-1)
        magnitude = np.abs(spectrum).sum(axis=0)
        power = np.square(np.abs(spectrum)).sum(axis=0)
        weighted[first:last] = (magnitude * frequencies).sum(axis=1)
        magnitude_total[first:last] = magnitude.sum(axis=1)
        bass_power[first:last] = power[:, bass_bins].sum(axis=1)
        total_power[first:last] = power.sum(axis=1)
        if previous is not None:
            flux[first] = np.maximum(magnitude[0] - previous, 0.0).sum()
        flux[first + 1 : last] = np.maximum(np.diff(magnitude, axis=0), 0.0).sum(axis=1)
        previous = magnitude[-1]
    peak = flux.max(initial=0.0)
    onset = flux / peak if peak > 0 else flux
    return rms, _ratio(weighted, magnitude_total), _ratio(bass_power, total_power), onset


def _mean_tempogram(onset: np.ndarray, sample_rate: int, hop_length: int) -> np.ndarray:
    """Time-averaged tempogram equal to librosa's default global tempo input.

    librosa materializes one autocorrelation column per onset frame before
    averaging, which needs gigabytes for long recordings. Each column depends
    only on its own window of the padded envelope, so the mean is accumulated
    over chunks of columns instead.
    """
    import librosa

    win_length = int(librosa.time_to_frames(8.0, sr=sample_rate, hop_length=hop_length))
    padded = np.pad(onset, win_length // 2, mode="linear_ramp", end_values=(0, 0))
    total = np.zeros(win_length)
    for first in range(0, onset.size, _TEMPOGRAM_FRAMES_PER_CHUNK):
        last = min(first + _TEMPOGRAM_FRAMES_PER_CHUNK, onset.size)
        columns = librosa.feature.tempogram(
            onset_envelope=padded[first : last + win_length - 1],
            sr=sample_rate,
            hop_length=hop_length,
            win_length=win_length,
            center=False,
        )
        total += columns.sum(axis=1)
    return (total / onset.size)[:, np.newaxis]


def _estimate_beats(onset: np.ndarray, timestamps, sample_rate: int, hop_length: int):
    if not np.any(onset):
        return None, ()
    import librosa

    try:
        tempogram = _mean_tempogram(onset, sample_rate, hop_length)
        bpm = librosa.feature.tempo(tg=tempogram, sr=sample_rate, hop_length=hop_length)
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset,
            sr=sample_rate,
            hop_length=hop_length,
            bpm=float(bpm.reshape(-1)[0]),
            sparse=True,
            units="frames",
        )
    except Exception as error:
        raise AnalysisError(f"beat tracking failed: {error}") from error
    tempo_values = np.asarray(tempo, dtype=np.float64).reshape(-1)
    if tempo_values.size == 0 or not np.isfinite(tempo_values[0]) or tempo_values[0] <= 0:
        return None, ()
    indices = sorted({int(frame) for frame in beat_frames if 0 <= frame < len(timestamps)})
    beats = tuple(BeatPosition(frame_index=i, seconds=timestamps[i]) for i in indices)
    if not beats:
        return None, ()
    return float(tempo_values[0]), beats


def extract_baseline(decoded: DecodedAudio, config: AnalysisConfig) -> AnalysisMeasurements:
    """Measure RMS, centroid, bass ratio, onset strength, tempo, and beats."""
    _check_consistency(decoded, config)
    samples, sample_rate = decoded.samples, decoded.sample_rate
    frame_length, hop_length = config.frame_length, config.hop_length
    sample_count = samples.shape[1]
    frames = _frame_count(sample_count, frame_length, hop_length)
    omitted = _omitted_tail(sample_count, frames, frame_length, hop_length)
    starts = [i * hop_length for i in range(frames)]
    timing = (
        tuple((start + frame_length / 2) / sample_rate for start in starts),
        tuple(start / sample_rate for start in starts),
        tuple((start + frame_length) / sample_rate for start in starts),
    )
    warnings: list[str] = []
    if frames == 0:
        warnings.append(
            f"audio has {sample_count} samples, shorter than one {frame_length}-sample frame; "
            "no features were measured"
        )
        rms, centroid, bass, onset = np.empty(0), [], [], np.empty(0)
    else:
        try:
            rms, centroid, bass, onset = _measure_frames(samples, sample_rate, config, frames)
        except (FloatingPointError, MemoryError) as error:
            raise AnalysisError(f"feature extraction failed: {error}") from error
    tempo, beats = _estimate_beats(onset, timing[0], sample_rate, hop_length)
    if frames and not beats:
        warnings.append("no tempo or beat positions were detected")
    return AnalysisMeasurements(
        rms=_series("rms", "linear_amplitude", timing, [float(v) for v in rms]),
        spectral_centroid=_series("spectral_centroid", "Hz", timing, centroid),
        bass_power_ratio=_series("bass_power_ratio", "ratio", timing, bass),
        onset_strength=_series(
            "onset_strength", "normalized_flux", timing, [float(v) for v in onset]
        ),
        tempo_bpm=tempo,
        beats=beats,
        diagnostics=AnalysisDiagnostics(
            analyzed_frames=frames, omitted_tail_samples=omitted, warnings=tuple(warnings)
        ),
    )
