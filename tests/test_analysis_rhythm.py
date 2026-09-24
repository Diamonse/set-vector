"""Beat This! first, the baseline tracker second, and no grid when neither is reliable."""

from dataclasses import replace
from importlib.metadata import version

import numpy as np
import pytest

from setvector.analysis import baseline_identity, extract_rhythm, rhythm_identity
from setvector.analysis.beat_this import Detection
from setvector.analysis.rhythm import _nearest
from setvector.domain import (
    AnalysisConfig,
    AudioAsset,
    BeatPosition,
    RhythmAnalysis,
)
from setvector.ingestion import DecodedAudio
from setvector.storage import compute_rhythm_id

PERIOD = 60.0 / 124.0


@pytest.fixture
def context(tmp_path, report_inputs):
    """Decoded silence of 60 s and a bundle whose baseline beats the tests control."""

    def build(baseline_beats=()):
        _, bundle = report_inputs(frames=240)
        timestamps = bundle.measurements.rms.timestamps  # 0.25 + 0.5 * i
        beats = tuple(BeatPosition(frame_index=i, seconds=timestamps[i]) for i in baseline_beats)
        measurements = replace(bundle.measurements, tempo_bpm=120.0 if beats else None, beats=beats)
        bundle = replace(bundle, measurements=measurements)
        asset = AudioAsset(
            asset_id=bundle.asset_id,
            observed_path=str((tmp_path / "x.wav").resolve()),
            byte_size=44,
            duration_seconds=60.0,
            native_sample_rate=1_000,
            channels=1,
            format="WAV",
            subtype="FLOAT",
        )
        decoded = DecodedAudio(
            asset=asset, samples=np.zeros((1, 60_000), np.float32), sample_rate=1_000
        )
        extractor = rhythm_identity(bundle.extractor)
        return decoded, bundle, extractor, compute_rhythm_id(bundle.feature_id, extractor)

    return build


def regular(count=100, start=0.4, first_downbeat=2, bar=4):
    beats = np.round((start + np.arange(count) * PERIOD) * 50) / 50
    return Detection(beats=beats, downbeats=beats[first_downbeat::bar])


def run(context_args, detection):
    decoded, bundle, extractor, rhythm_id = context_args
    return extract_rhythm(decoded, bundle, extractor, rhythm_id, runner=lambda s, r: detection)


def test_regular_beat_this_grid_is_chosen_with_bars(context):
    rhythm = run(context(), regular())
    assert isinstance(rhythm, RhythmAnalysis)
    assert rhythm.source == "beat_this" and rhythm.reliable and rhythm.reasons == ()
    assert rhythm.tempo_bpm == pytest.approx(124.0, abs=0.01)
    assert rhythm.bar_positions[:6] == (3, 4, 1, 2, 3, 4)  # two pickup beats
    assert set(rhythm.bar_positions) == {1, 2, 3, 4}
    assert rhythm.downbeats[0] == pytest.approx(0.4 + 2 * PERIOD, abs=0.011)
    assert rhythm.quality["beat_this"].modal_bar_length == 4
    assert "setvector_fallback" not in rhythm.quality


def test_missing_downbeat_keeps_counting_bars(context):
    detection = regular()
    detection = Detection(beats=detection.beats, downbeats=np.delete(detection.downbeats, 5))
    rhythm = run(context(), detection)
    assert max(rhythm.bar_positions) == 4
    assert bar_lengths(rhythm.bar_positions) == {4}


def bar_lengths(positions):
    starts = [i for i, position in enumerate(positions) if position == 1]
    return set(np.diff(starts).tolist())


def test_a_spurious_downbeat_does_not_break_bars(context):
    detection = regular()
    spurious = np.sort(np.append(detection.downbeats, detection.beats[41]))
    rhythm = run(context(), Detection(beats=detection.beats, downbeats=spurious))
    assert rhythm.source == "beat_this"
    assert bar_lengths(rhythm.bar_positions) == {4}


def test_a_sustained_bar_shift_is_followed(context):
    beats = regular().beats
    # One 2-beat bar: downbeats at beats 2, 6, ..., 50, then 52, 56, ...
    shifted = np.concatenate([beats[2:51:4], beats[52::4]])
    rhythm = run(context(), Detection(beats=beats, downbeats=shifted))
    assert rhythm.source == "beat_this"
    downbeat_indices = [i for i, position in enumerate(rhythm.bar_positions) if position == 1]
    assert {46, 50, 52, 56} <= set(downbeat_indices)
    assert bar_lengths(rhythm.bar_positions) == {2, 4}


def without(detection, missing):
    """Drop the beats at ``missing`` indices, and any downbeat among them."""
    missed = detection.beats[missing]
    return Detection(
        beats=np.delete(detection.beats, missing),
        downbeats=np.setdiff1d(detection.downbeats, missed),
    )


@pytest.mark.parametrize(
    "missing",
    [
        pytest.param(list(range(50, 54)), id="four-beat gap"),
        # Two of these misses are downbeats. Bars are measured on the fitted grid, which
        # fills missed beats in, so where the misses fall does not matter.
        pytest.param([10, 25, 40, 55, 70, 85], id="six single misses"),
    ],
)
def test_missed_beats_do_not_fail_the_interval_check(context, missing):
    rhythm = run(context(), without(regular(), missing))
    assert rhythm.source == "beat_this" and rhythm.reliable and rhythm.reasons == ()
    assert rhythm.tempo_bpm == pytest.approx(124.0, abs=0.01)
    assert rhythm.quality["beat_this"].interval_cv < 0.05


def test_off_beat_extra_detections_fail_the_interval_check(context):
    detection = regular()
    rng = np.random.default_rng(0)
    chosen = np.sort(rng.choice(detection.beats.size - 1, 30, replace=False))
    extra = np.sort(np.append(detection.beats, detection.beats[chosen] + PERIOD / 2))
    rhythm = run(context(), Detection(beats=extra, downbeats=detection.downbeats))
    assert rhythm.source == "none"
    assert any(reason.startswith("beat_this: beat intervals vary") for reason in rhythm.reasons)


@pytest.mark.parametrize("downbeats", [[], [5]], ids=["none", "one"])
def test_too_few_downbeats_reads_as_no_bars(context, downbeats):
    detection = regular()
    downbeats = detection.beats[downbeats]
    rhythm = run(context(), Detection(beats=detection.beats, downbeats=downbeats))
    assert rhythm.source == "none"
    assert "beat_this: no bars detected" in rhythm.reasons
    assert not any("None" in reason for reason in rhythm.reasons)


def dense_nearest(times, targets):
    """The quadratic-memory reference: the lowest index of the closest time."""
    return np.argmin(np.abs(times[None, :] - targets[:, None]), axis=1)


@pytest.mark.parametrize("seed", range(20))
def test_nearest_matches_the_dense_reference(seed):
    rng = np.random.default_rng(seed)
    times = np.unique(np.round(rng.uniform(0, 100, rng.integers(1, 60)), 1))
    targets = np.round(rng.uniform(-20, 120, 200), 1)  # outside the range too
    midpoints = (times[:-1] + times[1:]) / 2  # exact ties where representable
    targets = np.concatenate([targets, midpoints, times])
    np.testing.assert_array_equal(_nearest(times, targets), dense_nearest(times, targets))


def test_nearest_breaks_exact_ties_toward_the_lower_index():
    times = np.array([0.0, 1.0, 2.0, 4.0])
    targets = np.array([-1.0, 0.5, 1.5, 3.0, 9.0])
    np.testing.assert_array_equal(_nearest(times, targets), [0, 0, 1, 2, 3])
    np.testing.assert_array_equal(dense_nearest(times, targets), [0, 0, 1, 2, 3])


def test_downbeats_outside_the_grid_are_ignored(context):
    detection = regular()  # grid beats from 0.4 s to about 48.3 s
    stray = np.concatenate([[0.0, 0.05], detection.downbeats, [70.0, 75.0]])
    rhythm = run(context(), Detection(beats=detection.beats, downbeats=stray))
    assert rhythm.source == "beat_this"
    assert rhythm.quality["beat_this"].bar_regularity == 1.0
    assert bar_lengths(rhythm.bar_positions) == {4}
    assert rhythm.bar_positions[:6] == (3, 4, 1, 2, 3, 4)


def test_unsorted_duplicate_and_nan_detections_are_cleaned(context):
    beats = regular().beats
    rng = np.random.default_rng(0)
    messy = rng.permutation(np.concatenate([beats, [beats[10], np.nan]]))
    rhythm = run(context(), Detection(beats=messy, downbeats=regular().downbeats))
    assert rhythm.source == "beat_this" and rhythm.reliable
    assert rhythm.detected_beats == tuple(beats.tolist())
    assert rhythm.quality["beat_this"].beat_count == beats.size


def test_stereo_is_averaged_to_one_channel(context):
    decoded, bundle, extractor, rhythm_id = context()
    left = np.linspace(-0.5, 0.5, 60_000, dtype=np.float32)
    right = np.full(60_000, 0.25, dtype=np.float32)
    stereo = DecodedAudio(
        asset=replace(decoded.asset, channels=2),
        samples=np.stack([left, right]),
        sample_rate=1_000,
    )
    received = []

    def runner(samples, sample_rate):
        received.append((samples, sample_rate))
        return regular()

    rhythm = extract_rhythm(stereo, bundle, extractor, rhythm_id, runner=runner)
    ((samples, sample_rate),) = received
    assert samples.ndim == 1 and sample_rate == 1_000
    np.testing.assert_allclose(samples, (left + right) / 2, rtol=0, atol=1e-7)
    assert rhythm.source == "beat_this"


def test_irregular_beat_this_falls_back_to_regular_baseline_beats(context):
    rng = np.random.default_rng(0)
    erratic = np.sort(rng.uniform(0, 59, 60))
    rhythm = run(context(baseline_beats=range(0, 118)), Detection(erratic, erratic[::3]))
    assert rhythm.source == "setvector_fallback" and rhythm.reliable
    assert rhythm.downbeats == () and set(rhythm.bar_positions) == {None}
    assert rhythm.tempo_bpm == pytest.approx(120.0, abs=0.01)
    assert any(reason.startswith("beat_this:") for reason in rhythm.reasons)
    assert any(reason.startswith("beat_this: beat intervals vary") for reason in rhythm.reasons)
    assert set(rhythm.quality) == {"beat_this", "setvector_fallback"}


def test_nothing_reliable_gives_no_grid(context):
    rhythm = run(context(baseline_beats=range(0, 20)), Detection(np.empty(0), np.empty(0)))
    assert rhythm.source == "none" and not rhythm.reliable
    assert rhythm.beats == () and rhythm.tempo_bpm is None
    assert any("setvector_fallback" in reason for reason in rhythm.reasons)


def test_three_beat_bars_are_accepted_but_five_are_not(context):
    assert run(context(), regular(bar=3)).source == "beat_this"
    five = run(context(baseline_beats=range(0, 20)), regular(bar=5))
    assert five.source == "none"
    assert any("bar length is 5" in reason for reason in five.reasons)


def test_short_audio_skips_the_detector(context):
    decoded, bundle, extractor, rhythm_id = context()
    short = DecodedAudio(asset=decoded.asset, samples=decoded.samples[:, :500], sample_rate=1_000)

    def unexpected(samples, sample_rate):
        raise AssertionError("audio shorter than 1 s must not run the detector")

    rhythm = extract_rhythm(short, bundle, extractor, rhythm_id, runner=unexpected)
    assert rhythm.source == "none"


def test_rhythm_identity_records_model_thresholds_and_environment():
    config = AnalysisConfig(
        sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono"
    )
    identity = rhythm_identity(baseline_identity(config))
    assert identity.name == "rhythm-v1"
    assert identity.config == config
    assert identity.parameters["weights_sha256"] == (
        "c023aa1a8f9ce435c0639568c4478314765f54304588319fbd0022a4992893a7"
    )
    assert identity.parameters["upstream"] == "beat-this 1.1.0 (b95c8ab)"
    assert identity.parameters["min_grid_fit"] == 0.9
    assert identity.parameters["interval_gap_ratio"] == 1.5
    assert identity.parameters["bar_phase_confirm"] == 4
    assert identity.dependency_versions["torch"] == version("torch")
    assert set(identity.dependency_versions) == {
        "einops",
        "librosa",
        "numpy",
        "rotary-embedding-torch",
        "scipy",
        "soxr",
        "torch",
    }
