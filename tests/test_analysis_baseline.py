"""Deterministic baseline measurements on generated signals."""

from dataclasses import replace
from importlib.metadata import version

import librosa
import numpy as np
import pytest

import setvector.analysis.baseline as baseline_module
from setvector.analysis import baseline_identity, extract_baseline
from setvector.analysis.identity import BEAT_TRIM
from setvector.domain import AnalysisConfig, AnalysisError, AudioAsset
from setvector.ingestion import DecodedAudio

SERIES = ("rms", "spectral_centroid", "bass_power_ratio", "onset_strength")


@pytest.fixture
def decoded_factory(tmp_path):
    def build(samples, sample_rate):
        samples = np.asarray(samples, dtype=np.float32)
        asset = AudioAsset(
            asset_id="a" * 64,
            observed_path=str((tmp_path / "generated.wav").resolve()),
            byte_size=44,
            duration_seconds=samples.shape[1] / sample_rate,
            native_sample_rate=sample_rate,
            channels=samples.shape[0],
            format="WAV",
            subtype="FLOAT",
        )
        return DecodedAudio(asset=asset, samples=samples, sample_rate=sample_rate)

    return build


def click_train(sample_rate=8_000, seconds=8.0, interval=0.5):
    signal = np.zeros(int(sample_rate * seconds), dtype=np.float32)
    rng = np.random.default_rng(0)
    for start in range(0, signal.size, int(sample_rate * interval)):
        burst = rng.standard_normal(80).astype(np.float32) * np.hanning(80).astype(np.float32)
        signal[start : start + burst.size] = burst[: signal.size - start]
    return signal[None, :]


def test_only_full_left_aligned_frames_are_measured(decoded_factory):
    decoded = decoded_factory(np.ones((1, 10), dtype=np.float32), sample_rate=10)
    config = AnalysisConfig(sample_rate=None, frame_length=4, hop_length=3, channel_policy="mono")
    result = extract_baseline(decoded, config)
    assert result.rms.timestamps == pytest.approx((0.2, 0.5, 0.8))
    assert result.rms.window_starts == pytest.approx((0.0, 0.3, 0.6))
    assert result.rms.window_ends == pytest.approx((0.4, 0.7, 1.0))
    assert result.diagnostics.analyzed_frames == 3
    assert result.diagnostics.omitted_tail_samples == 0


def test_partial_tail_is_counted_not_padded(decoded_factory):
    decoded = decoded_factory(np.ones((1, 12), dtype=np.float32), sample_rate=10)
    config = AnalysisConfig(sample_rate=None, frame_length=4, hop_length=3, channel_policy="mono")
    result = extract_baseline(decoded, config)
    assert result.diagnostics.analyzed_frames == 3
    assert result.diagnostics.omitted_tail_samples == 2
    assert result.rms.window_ends[-1] == pytest.approx(1.0)


def test_silence_has_zero_amplitude_and_missing_spectral_values(decoded_factory):
    config = AnalysisConfig(sample_rate=None, frame_length=8, hop_length=4, channel_policy="mono")
    result = extract_baseline(decoded_factory(np.zeros((1, 12), np.float32), 8), config)
    assert result.rms.values == (0.0, 0.0)
    assert result.onset_strength.values == (0.0, 0.0)
    assert result.spectral_centroid.values == (None, None)
    assert result.spectral_centroid.validity == (False, False)
    assert result.bass_power_ratio.values == (None, None)
    assert result.tempo_bpm is None
    assert result.beats == ()


def test_clip_shorter_than_one_frame_returns_empty_series_and_warning(decoded_factory):
    config = AnalysisConfig(sample_rate=None, frame_length=8, hop_length=4, channel_policy="mono")
    result = extract_baseline(decoded_factory(np.ones((1, 5), np.float32), 8), config)
    for name in SERIES:
        assert getattr(result, name).values == ()
    assert result.diagnostics.analyzed_frames == 0
    assert result.diagnostics.omitted_tail_samples == 5
    assert any("shorter than one" in warning for warning in result.diagnostics.warnings)
    assert result.tempo_bpm is None


def test_sine_centroid_and_bass_ratio(decoded_factory):
    sample_rate = 8_000
    t = np.arange(sample_rate, dtype=np.float32) / sample_rate
    signal = np.sin(2 * np.pi * 200 * t)[None, :]
    config = AnalysisConfig(
        sample_rate=None, frame_length=2_000, hop_length=2_000, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(signal, sample_rate), config)
    assert np.mean(result.spectral_centroid.values) == pytest.approx(200.0, abs=8.0)
    assert min(result.bass_power_ratio.values) > 0.95
    assert np.mean(result.rms.values) == pytest.approx(1 / np.sqrt(2), rel=1e-3)


def test_high_tone_has_little_bass(decoded_factory):
    sample_rate = 8_000
    t = np.arange(sample_rate, dtype=np.float32) / sample_rate
    signal = np.sin(2 * np.pi * 2_000 * t)[None, :]
    config = AnalysisConfig(
        sample_rate=None, frame_length=2_000, hop_length=1_000, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(signal, sample_rate), config)
    assert max(result.bass_power_ratio.values) < 0.01
    assert np.mean(result.spectral_centroid.values) == pytest.approx(2_000.0, abs=20.0)


def test_preserve_does_not_cancel_antiphase_channels(decoded_factory):
    left = np.ones(8, dtype=np.float32)
    decoded = decoded_factory(np.stack([left, -left]), sample_rate=8)
    config = AnalysisConfig(
        sample_rate=None, frame_length=8, hop_length=8, channel_policy="preserve"
    )
    assert extract_baseline(decoded, config).rms.values == pytest.approx((1.0,))


def test_series_share_timing_and_labels(decoded_factory):
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(click_train(seconds=2.0), 8_000), config)
    timing = (result.rms.timestamps, result.rms.window_starts, result.rms.window_ends)
    for name in SERIES:
        series = getattr(result, name)
        assert (series.timestamps, series.window_starts, series.window_ends) == timing
        assert series.name == name


def test_quieter_intro_keeps_its_beats(decoded_factory):
    # DJ intros are often quieter than the main section; librosa's default beat
    # trimming used to discard every beat before the louder part began.
    intro, main = click_train(seconds=8.0), click_train(seconds=8.0)
    signal = np.concatenate([0.5 * intro, main], axis=1)
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(signal, 8_000), config)
    seconds = [beat.seconds for beat in result.beats]
    assert seconds[0] < 0.6
    assert sum(1 for s in seconds if s < 8.0) >= 14
    assert np.median(np.diff(seconds)) == pytest.approx(0.5, abs=0.03)


def test_header_duration_disagreeing_with_decoded_audio_is_warned(decoded_factory):
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="mono"
    )
    decoded = decoded_factory(click_train(seconds=2.0), 8_000)
    assert not any(
        "decoder reported" in w for w in extract_baseline(decoded, config).diagnostics.warnings
    )
    mismatched = DecodedAudio(
        asset=replace(decoded.asset, duration_seconds=10.7),
        samples=decoded.samples,
        sample_rate=decoded.sample_rate,
    )
    warnings = extract_baseline(mismatched, config).diagnostics.warnings
    assert any("decoder reported 10.70 s but 2.00 s of audio decoded" in w for w in warnings)


def test_click_train_produces_onsets_tempo_and_ordered_beats(decoded_factory):
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(click_train(), 8_000), config)
    assert max(result.onset_strength.values) == pytest.approx(1.0)
    assert min(result.onset_strength.values) >= 0.0
    assert result.tempo_bpm == pytest.approx(120.0, rel=0.05)
    indices = [beat.frame_index for beat in result.beats]
    assert indices == sorted(set(indices))
    assert len(result.beats) >= 8
    intervals = np.diff([beat.seconds for beat in result.beats])
    assert np.median(intervals) == pytest.approx(0.5, abs=0.03)
    for beat in result.beats:
        assert beat.seconds == result.rms.timestamps[beat.frame_index]


@pytest.mark.parametrize("chunk", [1, 3])
def test_chunking_does_not_change_measurements(decoded_factory, monkeypatch, chunk):
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="preserve"
    )
    signal = np.concatenate([click_train(seconds=2.0), 0.5 * click_train(seconds=2.0)])
    decoded = decoded_factory(signal, 8_000)
    expected = extract_baseline(decoded, config)
    monkeypatch.setattr(baseline_module, "_FRAMES_PER_CHUNK", chunk)
    result = extract_baseline(decoded, config)
    # Batched and single-row FFTs may differ in the last bits; nothing else may change.
    for name in SERIES:
        actual, reference = getattr(result, name), getattr(expected, name)
        assert actual.validity == reference.validity
        assert actual.timestamps == reference.timestamps
        valid = [v for v in actual.values if v is not None]
        np.testing.assert_allclose(
            valid, [v for v in reference.values if v is not None], rtol=1e-12, atol=1e-15
        )
    assert (result.tempo_bpm, result.beats) == (expected.tempo_bpm, expected.beats)
    assert result.diagnostics == expected.diagnostics


@pytest.mark.parametrize("chunk", [7, 500, 100_000])
def test_chunked_tempo_matches_librosa_beat_track(monkeypatch, chunk):
    rng = np.random.default_rng(3)
    onset = np.abs(rng.standard_normal(1_500))
    onset[::43] += 4.0
    timestamps = tuple(float(i) for i in range(onset.size))
    expected_tempo, expected_frames = librosa.beat.beat_track(
        onset_envelope=onset,
        sr=22_050,
        hop_length=512,
        sparse=True,
        units="frames",
        trim=BEAT_TRIM,
    )
    monkeypatch.setattr(baseline_module, "_TEMPOGRAM_FRAMES_PER_CHUNK", chunk)
    tempo, beats = baseline_module._estimate_beats(onset, timestamps, 22_050, 512)
    assert tempo == pytest.approx(float(np.asarray(expected_tempo).reshape(-1)[0]))
    assert [beat.frame_index for beat in beats] == [int(f) for f in expected_frames]


def test_tempo_estimation_memory_is_bounded():
    import tracemalloc

    onset = np.abs(np.random.default_rng(4).standard_normal(40_000))
    timestamps = tuple(float(i) for i in range(onset.size))
    tracemalloc.start()
    try:
        baseline_module._estimate_beats(onset, timestamps, 44_100, 512)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    # An unchunked tempogram for this envelope allocates more than 1 GB.
    assert peak < 150 * 2**20


def test_beat_tracker_failure_becomes_analysis_error(decoded_factory, monkeypatch):
    def failing(*args, **kwargs):
        raise librosa.util.exceptions.ParameterError("simulated")

    monkeypatch.setattr(librosa.beat, "beat_track", failing)
    config = AnalysisConfig(
        sample_rate=None, frame_length=512, hop_length=128, channel_policy="mono"
    )
    with pytest.raises(AnalysisError, match="beat"):
        extract_baseline(decoded_factory(click_train(seconds=2.0), 8_000), config)


def test_rejects_audio_inconsistent_with_config(decoded_factory):
    decoded = decoded_factory(np.ones((2, 16), np.float32), 8)
    mono = AnalysisConfig(sample_rate=None, frame_length=8, hop_length=4, channel_policy="mono")
    with pytest.raises(ValueError, match="mono"):
        extract_baseline(decoded, mono)
    resampled = AnalysisConfig(
        sample_rate=16, frame_length=8, hop_length=4, channel_policy="preserve"
    )
    with pytest.raises(ValueError, match="sample_rate"):
        extract_baseline(decoded, resampled)


def test_baseline_identity_records_parameters_and_environment():
    config = AnalysisConfig(
        sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono"
    )
    identity = baseline_identity(config)
    assert identity.name == "baseline-v1"
    assert identity.config == config
    assert identity.package_version == version("setvector")
    assert identity.algorithm_version == 2
    assert dict(identity.parameters) == {
        "bass_cutoff_hz": 250.0,
        "beat_trim": False,
        "onset_method": "positive_spectral_flux",
        "onset_normalization": "track_peak",
        "resampler": "soxr_hq_when_requested",
        "spectral_window": "hann",
    }
    assert set(identity.dependency_versions) == {"librosa", "numpy", "scipy", "soundfile", "soxr"}
    assert identity.dependency_versions["numpy"] == version("numpy")
