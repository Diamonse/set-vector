"""Generated, redistributable audio fixtures shared by workflow tests."""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisMeasurements,
    AudioAsset,
    BeatPosition,
    CandidateQuality,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
    GridSegment,
    RhythmAnalysis,
)
from setvector.storage import compute_feature_id, compute_rhythm_id

SAMPLE_RATE = 8_000


def write_click_tone(path: Path, seconds: float = 3.0, tone_hz: float = 220.0) -> Path:
    """Write a quiet tone with a click every half second as 16-bit WAV."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    signal = 0.1 * np.sin(2 * np.pi * tone_hz * t)
    for start in range(0, t.size, SAMPLE_RATE // 2):
        signal[start : start + 40] += 0.8 * np.hanning(40)[: t.size - start]
    sf.write(path, signal.astype(np.float32), SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return path


@pytest.fixture
def click_tone_writer():
    return write_click_tone


@pytest.fixture
def config():
    return AnalysisConfig(sample_rate=None, frame_length=512, hop_length=256, channel_policy="mono")


@pytest.fixture
def tone_path(tmp_path):
    directory = tmp_path / "música library"
    directory.mkdir()
    return write_click_tone(directory / "click tone ドラム.wav")


@pytest.fixture
def config_path(tmp_path, config):
    path = tmp_path / "analysis config.json"
    path.write_text(json.dumps(config.to_dict()), encoding="utf-8")
    return path


@pytest.fixture
def report_inputs(tmp_path):
    """Build a consistent (AudioAsset, FeatureBundle) pair without analyzing audio.

    Spectral values listed in ``missing`` are invalid; level and hits are always valid.
    """

    def build(
        frames=4,
        missing=(),
        beat_frames=(1,),
        tempo=120.0,
        warnings=(),
        name="Artist Name - Track Title.mp3",
        audio_format="MP3",
        sample_rate=44_100,
        channels=2,
    ):
        timestamps = tuple(0.25 + 0.5 * i for i in range(frames))
        starts = tuple(t - 0.25 for t in timestamps)
        ends = tuple(t + 0.25 for t in timestamps)

        def series(series_name, unit, value, can_be_missing):
            values = tuple(
                None if can_be_missing and i in missing else value(i) for i in range(frames)
            )
            return FeatureSeries(
                name=series_name,
                unit=unit,
                timestamps=timestamps,
                values=values,
                validity=tuple(v is not None for v in values),
                window_starts=starts,
                window_ends=ends,
            )

        beats = tuple(
            BeatPosition(frame_index=i, seconds=timestamps[i]) for i in beat_frames if i < frames
        )
        measurements = AnalysisMeasurements(
            rms=series("rms", "linear_amplitude", lambda i: 0.1 * (i % 9 + 1), False),
            spectral_centroid=series(
                "spectral_centroid", "Hz", lambda i: 1000.0 + 100 * (i % 30), True
            ),
            bass_power_ratio=series("bass_power_ratio", "ratio", lambda i: (i % 8) / 10, True),
            onset_strength=series(
                "onset_strength", "normalized_flux", lambda i: (i % 5) / 4, False
            ),
            tempo_bpm=tempo if beats else None,
            beats=beats,
            diagnostics=AnalysisDiagnostics(
                analyzed_frames=frames, omitted_tail_samples=7, warnings=tuple(warnings)
            ),
        )
        identity = ExtractorIdentity(
            name="baseline-v1",
            algorithm_version=1,
            package_version="0.1.0a1",
            config=AnalysisConfig(
                sample_rate=None, frame_length=22_050, hop_length=22_050, channel_policy="mono"
            ),
            parameters={"bass_cutoff_hz": 250.0},
            dependency_versions={"librosa": "0.11.0", "numpy": "2.4.6"},
        )
        asset = AudioAsset(
            asset_id="a" * 64,
            observed_path=str((tmp_path / name).resolve()),
            byte_size=1_000,
            duration_seconds=frames * 0.5 + 9.0,
            native_sample_rate=sample_rate,
            channels=channels,
            format=audio_format,
            subtype="MPEG_LAYER_III",
        )
        bundle = FeatureBundle(
            feature_id=compute_feature_id(asset.asset_id, identity),
            asset_id=asset.asset_id,
            config_id=identity.config.config_id,
            extractor=identity,
            measurements=measurements,
        )
        return asset, bundle

    return build


@pytest.fixture
def rhythm_factory():
    """Build a valid RhythmAnalysis for a stored FeatureBundle."""

    def build(bundle, source="beat_this", segments=None):
        extractor = ExtractorIdentity(
            name="rhythm-v1",
            algorithm_version=1,
            package_version="0.1.0a1",
            config=bundle.extractor.config,
            parameters={"model": "final0"},
            dependency_versions={"torch": "2.14.0"},
        )
        rhythm_id = compute_rhythm_id(bundle.feature_id, extractor)
        if source == "none":
            return RhythmAnalysis(
                rhythm_id=rhythm_id,
                asset_id=bundle.asset_id,
                feature_id=bundle.feature_id,
                extractor=extractor,
                source="none",
                grid_segments=(),
                beats=(),
                bar_positions=(),
                detected_beats=(),
                tempo_bpm=None,
                quality={"beat_this": CandidateQuality(3, None, None, 0, None, None)},
                reliable=False,
                reasons=("beat_this: 3 beats, fewer than 32",),
            )
        bars = source == "beat_this"
        segments = segments or (GridSegment(0.5, 120.0, 8, 1 if bars else None),)
        beats = tuple(t for segment in segments for t in segment.times())
        positions = tuple((i % 4) + 1 for i in range(len(beats))) if bars else (None,) * len(beats)
        return RhythmAnalysis(
            rhythm_id=rhythm_id,
            asset_id=bundle.asset_id,
            feature_id=bundle.feature_id,
            extractor=extractor,
            source=source,
            grid_segments=segments,
            beats=beats,
            bar_positions=positions,
            detected_beats=beats,
            tempo_bpm=max(segments, key=lambda s: s.beat_count).bpm,
            quality={
                source: CandidateQuality(
                    len(beats),
                    0.01,
                    1.0,
                    len(segments),
                    4 if bars else None,
                    1.0 if bars else None,
                )
            },
            reliable=True,
            reasons=(),
        )

    return build
