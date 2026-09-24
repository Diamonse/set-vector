"""Transform stored features into the data embedded in a track report."""

import base64
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from setvector.domain import AudioAsset, FeatureBundle, FeatureSeries, RhythmAnalysis

SERIES_NAMES = ("rms", "bass_power_ratio", "spectral_centroid", "onset_strength")
BASS_BANDS = ((0.3, "Light"), (0.6, "Moderate"), (float("inf"), "Heavy"))
BRIGHTNESS_BANDS = ((2_500.0, "Dark"), (4_000.0, "Balanced"), (float("inf"), "Bright"))
BASS_TIP = (
    "Display bands: Light below 30%, Moderate from 30% to 60%, Heavy from 60%. "
    "Fixed ranges for readability, not a calibrated judgment."
)
BRIGHTNESS_TIP = (
    "Display bands: Dark below 2.5 kHz, Balanced from 2.5 to 4 kHz, Bright from 4 kHz. "
    "Fixed ranges for readability, not a calibrated judgment."
)
NO_RHYTHM_WARNING = (
    "No rhythm analysis matches this installation, so beats come from the baseline tracker "
    "and bar lines are not shown. Run analyze again to add one."
)
NO_DOWNBEATS_WARNING = (
    "The beat grid comes from SetVector's own tracker, which does not detect downbeats, "
    "so bar lines are not shown."
)


@dataclass(frozen=True, slots=True)
class ReportSeries:
    """One feature as base64 little-endian float32 values, NaN where invalid."""

    name: str
    unit: str
    values: str


@dataclass(frozen=True, slots=True)
class ReportSummary:
    """Whole-track summaries shown in the stat cards."""

    bass_median: float | None
    bass_band: str | None
    centroid_median: float | None
    brightness_band: str | None
    bar_estimate: int | None
    bass_tip: str = BASS_TIP
    brightness_tip: str = BRIGHTNESS_TIP


@dataclass(frozen=True, slots=True)
class ReportModel:
    """Everything the report page needs, ready for JSON embedding."""

    feature_id: str
    asset_id: str
    title: str
    artist: str | None
    format_line: str
    duration_seconds: float
    tempo_bpm: float | None
    beats: tuple[float, ...]
    downbeats: tuple[float, ...]
    timestamps: str
    series: tuple[ReportSeries, ...]
    summary: ReportSummary
    warnings: tuple[str, ...]
    facts: tuple[tuple[str, str], ...]
    schema_version: int = 1

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-compatible dictionary without NaN or infinity."""
        return asdict(self)


def parse_title(observed_path: str) -> tuple[str, str | None]:
    """Split an ``Artist - Title`` filename; otherwise use the whole name as the title."""
    stem = Path(observed_path).stem
    artist, separator, title = stem.partition(" - ")
    if separator and artist.strip() and title.strip():
        return title.strip(), artist.strip()
    return stem, None


def band_for(value: float | None, bands: Sequence[tuple[float, str]]) -> str | None:
    """Return the display word for the first band whose upper edge exceeds ``value``."""
    if value is None:
        return None
    return next(word for edge, word in bands if value < edge)


def _encode(values: Sequence[float | None], dtype: str) -> str:
    array = np.asarray([np.nan if v is None else v for v in values], dtype=dtype)
    return base64.b64encode(array.tobytes()).decode("ascii")


def _median(series: FeatureSeries) -> float | None:
    valid = [v for v in series.values if v is not None]
    return float(np.median(valid)) if valid else None


def _format_line(asset: AudioAsset) -> str:
    rate = f"{asset.native_sample_rate / 1000:.1f}".removesuffix(".0")
    channels = {1: "mono", 2: "stereo"}.get(asset.channels, f"{asset.channels} channels")
    return f"{asset.format} · {rate} kHz · {channels}"


def _facts(bundle: FeatureBundle) -> tuple[tuple[str, str], ...]:
    extractor = bundle.extractor
    config = extractor.config
    diagnostics = bundle.measurements.diagnostics
    rate = "Native" if config.sample_rate is None else f"{config.sample_rate:,} Hz"
    return (
        ("Analyzed with", f"SetVector {extractor.package_version} · {extractor.name}"),
        ("Frame / hop", f"{config.frame_length:,} / {config.hop_length:,} samples"),
        ("Analysis sample rate", rate),
        ("Channels", "Mixed to mono" if config.channel_policy == "mono" else "Kept separate"),
        ("Frames measured", f"{diagnostics.analyzed_frames:,}"),
        ("Unmeasured tail", f"{diagnostics.omitted_tail_samples:,} samples"),
        ("Feature ID", bundle.feature_id),
        ("Audio ID", bundle.asset_id),
        (
            "Libraries",
            ", ".join(f"{name} {v}" for name, v in extractor.dependency_versions.items()),
        ),
    )


def _decoded_duration(asset: AudioAsset, bundle: FeatureBundle) -> float:
    """Derive duration from analyzed frames rather than the file header, which for MP3s with
    large ID3 tags and no Xing/Info frame can overstate length by counting tag bytes as audio.
    """
    config = bundle.extractor.config
    rate = config.sample_rate if config.sample_rate is not None else asset.native_sample_rate
    diagnostics = bundle.measurements.diagnostics
    hop = config.hop_length
    frame = config.frame_length
    if diagnostics.analyzed_frames > 0:
        decoded_samples = (diagnostics.analyzed_frames - 1) * hop + frame
        decoded_samples += diagnostics.omitted_tail_samples
    else:
        decoded_samples = diagnostics.omitted_tail_samples
    return decoded_samples / rate


def build_report_model(
    asset: AudioAsset, bundle: FeatureBundle, rhythm: RhythmAnalysis | None = None
) -> ReportModel:
    """Describe ``bundle`` for display without reading files or recomputing features.

    A reliable ``rhythm`` supplies the beat grid, downbeats, and tempo; otherwise the
    baseline beats are shown without bar lines and a warning says why.
    """
    if asset.asset_id != bundle.asset_id:
        raise ValueError("asset_id of the asset and bundle must match")
    if rhythm is not None and rhythm.feature_id != bundle.feature_id:
        raise ValueError("rhythm feature_id must match the bundle")
    measurements = bundle.measurements
    title, artist = parse_title(asset.observed_path)
    bass = _median(measurements.bass_power_ratio)
    centroid = _median(measurements.spectral_centroid)
    beats = tuple(beat.seconds for beat in measurements.beats)
    downbeats: tuple[float, ...] = ()
    tempo = measurements.tempo_bpm
    warnings = measurements.diagnostics.warnings
    if rhythm is None:
        warnings += (NO_RHYTHM_WARNING,)
    elif not rhythm.reliable:
        warnings += (
            f"No reliable beat grid: {'; '.join(rhythm.reasons)}. "
            "Beats come from the baseline tracker and bar lines are not shown.",
        )
    else:
        beats, downbeats, tempo = rhythm.beats, rhythm.downbeats, rhythm.tempo_bpm
        if not downbeats:
            warnings += (NO_DOWNBEATS_WARNING,)
    duration = _decoded_duration(asset, bundle)
    return ReportModel(
        feature_id=bundle.feature_id,
        asset_id=bundle.asset_id,
        title=title,
        artist=artist,
        format_line=_format_line(asset),
        duration_seconds=duration,
        tempo_bpm=tempo,
        beats=beats,
        downbeats=downbeats,
        timestamps=_encode(measurements.rms.timestamps, "<f8"),
        series=tuple(
            ReportSeries(
                name=name,
                unit=getattr(measurements, name).unit,
                values=_encode(getattr(measurements, name).values, "<f4"),
            )
            for name in SERIES_NAMES
        ),
        summary=ReportSummary(
            bass_median=bass,
            bass_band=band_for(bass, BASS_BANDS),
            centroid_median=centroid,
            brightness_band=band_for(centroid, BRIGHTNESS_BANDS),
            bar_estimate=round(duration * tempo / 240) if tempo is not None else None,
        ),
        warnings=warnings,
        facts=_facts(bundle),
    )
