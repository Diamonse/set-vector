# Audio Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully local `setvector analyze` workflow that identifies and decodes an audio file, extracts deterministic baseline measurements, and atomically stores reusable feature artifacts.

**Architecture:** Domain contracts carry immutable metadata and measurements between four focused boundaries: SoundFile/soxr ingestion, NumPy/librosa analysis, an atomic JSON/NPZ artifact store, and application orchestration. The application computes an environment-aware feature identity before decoding so an intact cache entry can be reused, while the CLI only parses input, maps known errors, and emits JSON.

**Tech Stack:** Python 3.11+, NumPy 2.4.6, SciPy 1.17.1, SoundFile 0.14.0, librosa 0.11.0, soxr 1.1.0, pytest 9.1.1, Ruff 0.16.8, Hatchling 1.32.4

**Spec:** `docs/superpowers/specs/2026-09-22-audio-analysis-pipeline-design.md`

## Global Constraints

- Runtime analysis must work without GPT access, API keys, hosted models, telemetry, or network requests after dependencies are installed.
- Support Python 3.11 or newer and use the exact tested dependency versions listed in **Tech Stack**.
- SoundFile/libsndfile decides format support from file content; do not accept or reject a file from its extension.
- Preserve native sample rate when `AnalysisConfig.sample_rate` is `None`; otherwise resample locally with soxr HQ and record that choice in extractor identity.
- Decode `float32` samples without peak or loudness normalization; represent decoded samples as read-only `(channels, samples)` arrays.
- Use only full, left-aligned frames. Do not center or pad frames. Record omitted tail samples.
- Keep numerical analysis free of filesystem access and keep storage free of signal-processing decisions.
- Use strict, versioned JSON contracts and reject missing, unknown, or duplicate JSON fields.
- Load NPZ files with `allow_pickle=False`; store missing numeric observations as a numeric placeholder plus a separate boolean mask.
- Publish artifacts by validating a temporary sibling directory before an atomic rename; never treat a partial directory as a cache hit or overwrite a corrupt completed artifact.
- Use Conventional Commit subjects and add no commit trailers or assistant attribution. Keep all commits local.

---

### Task 1: Runtime dependencies and audio result contracts

**Files:**
- Modify: `pyproject.toml`
- Modify: `requirements-dev.txt`
- Create: `src/setvector/domain/errors.py`
- Create: `src/setvector/domain/audio.py`
- Create: `src/setvector/domain/bundle.py`
- Modify: `src/setvector/domain/__init__.py`
- Modify: `src/setvector/__init__.py`
- Create: `tests/test_domain_audio.py`
- Create: `tests/test_domain_bundle.py`

**Interfaces:**
- Consumes: `AnalysisConfig` and `FeatureSeries` from `setvector.domain`.
- Produces: `SetVectorError`, `InputError`, `UnsupportedAudioError`, `DecodeError`, `AnalysisError`, and `ArtifactError`.
- Produces: `AudioAsset(asset_id: str, observed_path: str, byte_size: int, duration_seconds: float, native_sample_rate: int, channels: int, format: str, subtype: str, schema_version: int = 1)` with strict `from_dict()` and `to_dict()`.
- Produces: `BeatPosition(frame_index: int, seconds: float)`, `AnalysisDiagnostics(analyzed_frames: int, omitted_tail_samples: int, warnings: tuple[str, ...])`, and `AnalysisMeasurements(rms: FeatureSeries, spectral_centroid: FeatureSeries, bass_power_ratio: FeatureSeries, onset_strength: FeatureSeries, tempo_bpm: float | None, beats: tuple[BeatPosition, ...], diagnostics: AnalysisDiagnostics)`.
- Produces: `JsonScalar = str | int | float | bool | None` and `ExtractorIdentity(name: str, algorithm_version: int, package_version: str, config: AnalysisConfig, parameters: Mapping[str, JsonScalar], dependency_versions: Mapping[str, str], schema_version: int = 1)`; constructor copies mappings into sorted immutable mappings.
- Produces: `FeatureBundle(feature_id: str, asset_id: str, config_id: str, extractor: ExtractorIdentity, measurements: AnalysisMeasurements, schema_version: int = 1)`.
- All IDs are lowercase 64-character SHA-256 hex strings. All finite numeric fields reject booleans, NaN, and infinity. Collections are defensively copied and immutable.
- `AnalysisMeasurements` enforces the exact four feature names and units, identical timing arrays, `diagnostics.analyzed_frames == len(rms.values)`, ordered in-range beat indices whose seconds equal the indexed timestamps, and the invariant that tempo is absent exactly when the beat tuple is empty.

- [x] **Step 1: Add failing audio-contract tests**

```python
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
```

- [x] **Step 2: Add failing bundle immutability and consistency tests**

```python
def test_extractor_identity_copies_mutable_inputs(config):
    parameters = {"bass_cutoff_hz": 250.0, "spectral_window": "hann"}
    dependencies = {"numpy": "2.4.6"}
    identity = ExtractorIdentity(
        name="baseline-v1",
        algorithm_version=1,
        package_version="0.1.0a1",
        config=config,
        parameters=parameters,
        dependency_versions=dependencies,
    )
    parameters["bass_cutoff_hz"] = 80.0
    assert identity.to_dict()["parameters"]["bass_cutoff_hz"] == 250.0


def test_feature_bundle_rejects_mismatched_config_id(config, measurements, identity):
    with pytest.raises(ValueError, match="config_id"):
        FeatureBundle(
            feature_id="f" * 64,
            asset_id="a" * 64,
            config_id="0" * 64,
            extractor=identity,
            measurements=measurements,
        )


def test_measurements_reject_mislabeled_or_incoherent_series(measurements):
    mislabeled = replace(measurements.rms, name="loudness")
    with pytest.raises(ValueError, match="rms.*linear_amplitude"):
        replace(measurements, rms=mislabeled)
    with pytest.raises(ValueError, match="analyzed_frames"):
        replace(
            measurements,
            diagnostics=replace(measurements.diagnostics, analyzed_frames=999),
        )
```

- [x] **Step 3: Run the new tests and confirm the imports fail**

Run: `python -m pytest tests/test_domain_audio.py tests/test_domain_bundle.py -q`

Expected: FAIL during collection because the new contracts are not defined.

- [x] **Step 4: Pin the local runtime and development environment**

```toml
dependencies = [
    "librosa==0.11.0",
    "numpy==2.4.6",
    "scipy==1.17.1",
    "soundfile==0.14.0",
    "soxr==1.1.0",
]
```

Add the same five pins to `requirements-dev.txt` while retaining the existing development pins. Do not add HTTP, cloud, model-client, or telemetry packages directly.

- [x] **Step 5: Implement strict immutable contracts and errors**

```python
class SetVectorError(Exception):
    """Base class for expected SetVector failures."""


class InputError(SetVectorError):
    """The caller supplied an invalid path, format, or configuration."""


class UnsupportedAudioError(InputError):
    """The local decoder cannot inspect the supplied audio content."""


class DecodeError(SetVectorError):
    """A supported audio asset could not be decoded."""


class AnalysisError(SetVectorError):
    """Feature extraction failed for decoded audio."""


class ArtifactError(SetVectorError):
    """A local artifact is incomplete, corrupt, or incompatible."""
```

Implement each dataclass with `frozen=True, slots=True`, strict field sets in `from_dict()`, detached JSON-compatible values from `to_dict()`, finite-number validation, SHA-256 validation, and tuple or immutable mapping copies. `FeatureBundle` must require `config_id == extractor.config.config_id`. `AnalysisMeasurements` must enforce the semantic and timing invariants in **Interfaces**, including setting tempo to `None` whenever no valid beat remains after extraction.

- [x] **Step 6: Export the public contracts and run domain tests**

```python
from .audio import AudioAsset
from .bundle import (
    AnalysisDiagnostics,
    AnalysisMeasurements,
    BeatPosition,
    ExtractorIdentity,
    FeatureBundle,
)
from .errors import (
    AnalysisError,
    ArtifactError,
    DecodeError,
    InputError,
    SetVectorError,
    UnsupportedAudioError,
)
```

Run: `python -m pytest tests/test_domain_audio.py tests/test_domain_bundle.py tests/test_domain_config.py tests/test_domain_features.py -q`

Expected: PASS.

- [x] **Step 7: Lint and commit**

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

```bash
git add pyproject.toml requirements-dev.txt src/setvector tests/test_domain_audio.py tests/test_domain_bundle.py
git commit -m "feat(domain): add audio analysis contracts"
```

---

### Task 2: Content-based audio ingestion

**Files:**
- Create: `src/setvector/ingestion/__init__.py`
- Create: `src/setvector/ingestion/audio.py`
- Create: `tests/test_ingestion.py`

**Interfaces:**
- Consumes: `AnalysisConfig`, `AudioAsset`, `InputError`, `UnsupportedAudioError`, and `DecodeError` from Task 1.
- Produces: immutable `DecodedAudio(asset: AudioAsset, samples: numpy.ndarray, sample_rate: int)`. Samples have `float32` dtype, `(channels, samples)` shape, and `writeable=False`.
- Produces: `inspect_audio(path: str | Path) -> AudioAsset` and `decode_audio(path: str | Path, asset: AudioAsset, config: AnalysisConfig) -> DecodedAudio`.
- `decode_audio()` verifies the bytes match `asset.asset_id` before and after decoding, reads through SoundFile with `dtype="float32"` and `always_2d=True`, applies `mono` or `preserve` while samples are `(samples, channels)`, passes that sample-major array directly to `soxr.resample(samples, native_rate, target_rate, quality="HQ")` only when a configured sample rate differs, and converts to channels-first after resampling.

- [x] **Step 1: Write generated-audio inspection and decode tests**

```python
import hashlib

import numpy as np
import soundfile as sf

from setvector.domain import AnalysisConfig
from setvector.ingestion import decode_audio, inspect_audio


def test_inspect_uses_content_hash_and_decoder_metadata(tmp_path):
    path = tmp_path / "song with spaces.unknown"
    sf.write(path, np.zeros((8_000, 2), dtype=np.float32), 8_000, format="WAV")
    asset = inspect_audio(path)
    assert asset.asset_id == hashlib.sha256(path.read_bytes()).hexdigest()
    assert asset.observed_path == str(path.resolve())
    assert asset.channels == 2
    assert asset.native_sample_rate == 8_000
    assert asset.duration_seconds == pytest.approx(1.0)
    assert asset.format == "WAV"


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
    assert not np.allclose(decoded.samples[0], decoded.samples[1])
```

- [x] **Step 2: Write failing path, corruption, mutation, and preserve tests**

```python
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
```

Also assert a Unicode path works, `preserve` retains both channels, native-rate mode retains the source rate, a directory is rejected, and an audio header in a file with an arbitrary extension succeeds.

- [x] **Step 3: Run ingestion tests and confirm they fail**

Run: `python -m pytest tests/test_ingestion.py -q`

Expected: FAIL during collection because `setvector.ingestion` does not exist.

- [x] **Step 4: Implement inspection and decoding**

```python
@dataclass(frozen=True, slots=True)
class DecodedAudio:
    asset: AudioAsset
    samples: np.ndarray
    sample_rate: int

    def __post_init__(self) -> None:
        samples = np.array(self.samples, dtype=np.float32, copy=True, order="C")
        if samples.ndim != 2 or samples.shape[0] < 1:
            raise ValueError("samples must have shape (channels, samples)")
        samples.setflags(write=False)
        object.__setattr__(self, "samples", samples)
```

`inspect_audio()` must resolve the path, reject non-files and zero bytes, calculate SHA-256 in chunks, call `soundfile.info()`, and translate unrecognized content to `UnsupportedAudioError`. `decode_audio()` must compare a fresh hash with the inspected ID both immediately before and immediately after `soundfile.read()`, translate decoder failures to `DecodeError`, reject empty decoded sample arrays, apply channel policy and resampling along the sample axis before transposing, and return a `DecodedAudio`. The second hash closes the ordinary mutation-during-read race and must run before decoded samples can be returned. Call the decoder as `soundfile.read(...)` through the module attribute so the mutation test's monkeypatch reaches it.

- [x] **Step 5: Run focused and regression tests**

Run: `python -m pytest tests/test_ingestion.py tests/test_domain_audio.py -q`

Expected: PASS.

- [x] **Step 6: Lint and commit**

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

```bash
git add src/setvector/ingestion tests/test_ingestion.py
git commit -m "feat(ingestion): decode local audio files"
```

---

### Task 3: Deterministic baseline feature extraction

**Files:**
- Create: `src/setvector/analysis/__init__.py`
- Create: `src/setvector/analysis/baseline.py`
- Create: `src/setvector/analysis/identity.py`
- Create: `tests/test_analysis_baseline.py`

**Interfaces:**
- Consumes: `DecodedAudio`, `AnalysisConfig`, `FeatureSeries`, `BeatPosition`, `AnalysisDiagnostics`, `AnalysisMeasurements`, `ExtractorIdentity`, and `AnalysisError`.
- Produces: `baseline_identity(config: AnalysisConfig) -> ExtractorIdentity` using package version plus installed versions for `numpy`, `scipy`, `soundfile`, `librosa`, and `soxr`.
- Produces: `extract_baseline(decoded: DecodedAudio, config: AnalysisConfig) -> AnalysisMeasurements`.
- Fixed parameters are `bass_cutoff_hz=250.0`, `spectral_window="hann"`, `onset_method="positive_spectral_flux"`, `onset_normalization="track_peak"`, and `resampler="soxr_hq_when_requested"`.
- Frames are processed in chunks of at most `_FRAMES_PER_CHUNK = 256` (a module constant tests may monkeypatch) so windowed samples and spectra stay bounded for full-length tracks. Chunking must not change any value.
- Every feature uses identical timestamps and windows. Feature names and units are exactly `rms`/`linear_amplitude`, `spectral_centroid`/`Hz`, `bass_power_ratio`/`ratio`, and `onset_strength`/`normalized_flux`.

- [x] **Step 1: Write failing full-frame timing and silence tests**

```python
def test_only_full_left_aligned_frames_are_measured(decoded_factory, config):
    decoded = decoded_factory(np.ones((1, 10), dtype=np.float32), sample_rate=10)
    config = AnalysisConfig(sample_rate=None, frame_length=4, hop_length=3, channel_policy="mono")
    result = extract_baseline(decoded, config)
    assert result.rms.timestamps == pytest.approx((0.2, 0.5, 0.8))
    assert result.rms.window_starts == pytest.approx((0.0, 0.3, 0.6))
    assert result.rms.window_ends == pytest.approx((0.4, 0.7, 1.0))
    assert result.diagnostics.analyzed_frames == 3
    assert result.diagnostics.omitted_tail_samples == 0


def test_silence_has_zero_amplitude_and_missing_spectral_values(decoded_factory):
    config = AnalysisConfig(sample_rate=None, frame_length=8, hop_length=4, channel_policy="mono")
    result = extract_baseline(decoded_factory(np.zeros((1, 12), np.float32), 8), config)
    assert result.rms.values == (0.0, 0.0)
    assert result.onset_strength.values == (0.0, 0.0)
    assert result.spectral_centroid.values == (None, None)
    assert result.bass_power_ratio.values == (None, None)
    assert result.tempo_bpm is None
    assert result.beats == ()
```

- [x] **Step 2: Write failing numerical and channel-policy tests**

```python
def test_sine_centroid_and_bass_ratio(decoded_factory):
    sample_rate = 8_000
    t = np.arange(sample_rate, dtype=np.float32) / sample_rate
    signal = np.sin(2 * np.pi * 200 * t)[None, :]
    config = AnalysisConfig(sample_rate=None, frame_length=2_000, hop_length=2_000, channel_policy="mono")
    result = extract_baseline(decoded_factory(signal, sample_rate), config)
    assert np.mean(result.spectral_centroid.values) == pytest.approx(200.0, abs=8.0)
    assert min(result.bass_power_ratio.values) > 0.95


def test_preserve_does_not_cancel_antiphase_channels(decoded_factory):
    left = np.ones(8, dtype=np.float32)
    decoded = decoded_factory(np.stack([left, -left]), sample_rate=8)
    config = AnalysisConfig(sample_rate=None, frame_length=8, hop_length=8, channel_policy="preserve")
    assert extract_baseline(decoded, config).rms.values == pytest.approx((1.0,))
```

Also test that forcing `_FRAMES_PER_CHUNK` to 1 and 3 yields measurements equal to the default (including onset values across chunk boundaries), a clip shorter than one frame returns four empty series plus a warning, a partial tail count is correct, a click train produces nonzero onset values and ordered beat positions, and every series shares the same timing arrays.

- [x] **Step 3: Run analysis tests and confirm they fail**

Run: `python -m pytest tests/test_analysis_baseline.py -q`

Expected: FAIL during collection because `setvector.analysis` does not exist.

- [x] **Step 4: Implement the identity and full-frame numerical path**

```python
def _frame_count(sample_count: int, frame_length: int, hop_length: int) -> int:
    if sample_count < frame_length:
        return 0
    return 1 + (sample_count - frame_length) // hop_length


def _omitted_tail(sample_count: int, frame_count: int, frame_length: int, hop_length: int) -> int:
    if frame_count == 0:
        return sample_count
    return sample_count - ((frame_count - 1) * hop_length + frame_length)
```

Use `numpy.lib.stride_tricks.sliding_window_view` or explicit indexed views without padding, and iterate over frame chunks of `_FRAMES_PER_CHUNK`; only per-frame scalars are accumulated across chunks. Carry the previous frame's channel-summed magnitude between chunks so flux is identical to an unchunked computation. Compute RMS from unwindowed samples over channels and time. Apply `np.hanning(frame_length)` before `np.fft.rfft`. Compute centroid from channel-summed magnitude and bass ratio from channel-summed power at bins `<= 250 Hz`; when the denominator is zero, emit `None` and `False`. Define flux frame zero as `0.0`, later frames as the sum of positive magnitude differences, and divide by the track maximum only when it is positive.

- [x] **Step 5: Add local tempo and beat extraction**

```python
if not np.any(onset_values):
    tempo_bpm = None
    beats = ()
else:
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=np.asarray(onset_values),
        sr=decoded.sample_rate,
        hop_length=config.hop_length,
        sparse=True,
        units="frames",
    )
```

Normalize the scalar/array tempo return to one finite positive `float`; otherwise use `None`. Retain only beat frame indices within the common grid and map each beat to the corresponding feature timestamp. Translate unexpected numerical/library failures into `AnalysisError` while allowing contract `ValueError`s to identify programmer mistakes in focused tests.

- [x] **Step 6: Run focused and regression tests**

Run: `python -m pytest tests/test_analysis_baseline.py tests/test_domain_bundle.py -q`

Expected: PASS.

- [x] **Step 7: Lint and commit**

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

```bash
git add src/setvector/analysis tests/test_analysis_baseline.py
git commit -m "feat(analysis): extract baseline audio features"
```

---

### Task 4: Atomic local feature artifacts

**Files:**
- Create: `src/setvector/storage/__init__.py`
- Create: `src/setvector/storage/canonical.py`
- Create: `src/setvector/storage/artifacts.py`
- Create: `tests/test_storage_artifacts.py`

**Interfaces:**
- Consumes: `AudioAsset`, `FeatureBundle`, `ExtractorIdentity`, all nested domain contracts, and `ArtifactError`.
- Produces: `canonical_json(value: Mapping[str, object]) -> bytes` using sorted keys, compact separators, UTF-8, and `allow_nan=False`.
- Produces: `compute_feature_id(asset_id: str, extractor: ExtractorIdentity) -> str`, hashing canonical JSON containing exactly `asset_id` and `extractor.to_dict()`.
- Produces: `ArtifactStore(workspace: str | Path)` that resolves `workspace` to an absolute path, with `manifest_path(feature_id: str) -> Path`, `load(feature_id: str, expected_asset: AudioAsset) -> FeatureBundle | None`, and `save(asset: AudioAsset, bundle: FeatureBundle) -> Path`.
- Layout is `<workspace>/assets/<asset-id>/asset.json` and `<workspace>/features/<feature-id>/{manifest.json,arrays.npz}`.
- `save()` and `load()` require `bundle.asset_id == asset.asset_id` and `bundle.feature_id == compute_feature_id(bundle.asset_id, bundle.extractor)`. A feature cache hit also requires a complete, strict `asset.json` whose identity and content metadata match the freshly inspected asset; `observed_path` may differ because paths do not participate in identity.

- [x] **Step 1: Write failing identity and round-trip tests**

```python
def test_feature_id_excludes_observed_path(asset, identity):
    first = compute_feature_id(asset.asset_id, identity)
    moved_path = (Path(asset.observed_path).parent / "moved" / "track.wav").resolve()
    moved = AudioAsset.from_dict({**asset.to_dict(), "observed_path": str(moved_path)})
    assert compute_feature_id(moved.asset_id, identity) == first


def test_store_round_trip_uses_json_and_non_pickle_npz(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path / "workspace")
    manifest = store.save(asset, bundle)
    assert manifest == store.manifest_path(bundle.feature_id)
    assert store.load(bundle.feature_id, asset) == bundle
    with np.load(manifest.parent / "arrays.npz", allow_pickle=False) as arrays:
        assert arrays["spectral_centroid__validity"].dtype == np.bool_
        assert arrays["spectral_centroid__values"].dtype.kind == "f"
```

- [x] **Step 2: Write failing cache-integrity and atomicity tests**

```python
def test_partial_feature_directory_is_an_error(tmp_path, asset):
    store = ArtifactStore(tmp_path)
    target = store.manifest_path("f" * 64).parent
    target.mkdir(parents=True)
    (target / "manifest.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ArtifactError, match="incomplete"):
        store.load("f" * 64, asset)


def test_corrupt_completed_artifact_is_not_overwritten(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    store.manifest_path(bundle.feature_id).write_text("{broken", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        store.save(asset, bundle)
    assert store.manifest_path(bundle.feature_id).read_text(encoding="utf-8") == "{broken"


def test_save_rejects_bundle_identity_mismatches(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    with pytest.raises(ArtifactError, match="asset_id"):
        store.save(asset, replace(bundle, asset_id="b" * 64))
    with pytest.raises(ArtifactError, match="feature_id"):
        store.save(asset, replace(bundle, feature_id="f" * 64))


def test_feature_cache_requires_valid_asset_artifact(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    asset_path = tmp_path / "assets" / asset.asset_id / "asset.json"
    asset_path.unlink()
    with pytest.raises(ArtifactError, match="asset"):
        store.load(bundle.feature_id, asset)
```

Monkeypatch the final feature rename to fail and assert no published feature target remains. Add tests for an absent feature ID returning `None`, duplicate JSON keys being rejected, incompatible schema versions, mismatched manifest IDs, missing arrays, a validity mask reconstructing invalid values as `None`, changed dependency/configuration identity changing the feature ID, and missing, corrupt, incompatible, or content-mismatched asset JSON rejecting a cache hit. Prove a stored asset with only a different absolute `observed_path` remains reusable.

- [x] **Step 3: Run storage tests and confirm they fail**

Run: `python -m pytest tests/test_storage_artifacts.py -q`

Expected: FAIL during collection because `setvector.storage` does not exist.

- [x] **Step 4: Implement canonical identity and explicit serialization**

```python
def canonical_json(value: Mapping[str, object]) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def compute_feature_id(asset_id: str, extractor: ExtractorIdentity) -> str:
    payload = {"asset_id": asset_id, "extractor": extractor.to_dict()}
    return hashlib.sha256(canonical_json(payload)).hexdigest()
```

The manifest stores identities, configuration, tempo, beats, diagnostics, and, for each series, its name, unit, schema version, and NPZ key names. The NPZ stores `timestamps`, `values`, `validity`, `window_starts`, and `window_ends` under a stable series prefix. Use zero only as the persisted placeholder where validity is false and reconstruct `None` before constructing `FeatureSeries`. On every load, reconstruct the strict bundle, recompute its feature ID, verify the directory/manifest/expected ID agree, load the strict asset JSON, and compare its identity plus all content-derived metadata to `expected_asset` while excluding `observed_path`.

- [x] **Step 5: Implement validated temporary-directory publication**

```python
temporary = Path(tempfile.mkdtemp(prefix=f".{feature_id}.tmp-", dir=parent))
try:
    _write_feature_directory(temporary, bundle)
    _load_feature_directory(temporary, expected_id=feature_id)
    os.replace(temporary, target)
except Exception:
    shutil.rmtree(temporary, ignore_errors=True)
    raise
```

Create parents before the temporary directory. Write UTF-8 JSON with a trailing newline and call `flush()` plus `os.fsync()` before close. Save NPZ through an open binary file so NumPy cannot append an unexpected suffix, flush/fsync it, validate the temporary files by reloading, then rename. Validate or atomically publish the asset directory before publishing the feature directory, so a visible feature always has its asset metadata. If a target exists, validate it: return its manifest only when its bundle equals the supplied bundle; otherwise raise `ArtifactError`. If `os.replace` fails because another writer published the target concurrently, remove the temporary directory and apply the same existing-target validation instead of failing. Apply the same sibling-temp pattern to `asset.json`. Before any write, validate the supplied asset/bundle relationship and recompute the feature ID.

- [x] **Step 6: Run focused and regression tests**

Run: `python -m pytest tests/test_storage_artifacts.py tests/test_domain_bundle.py -q`

Expected: PASS.

- [x] **Step 7: Lint and commit**

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

```bash
git add src/setvector/storage tests/test_storage_artifacts.py
git commit -m "feat(storage): persist atomic feature artifacts"
```

---

### Task 5: Analysis application service and CLI

**Files:**
- Create: `src/setvector/application/__init__.py`
- Create: `src/setvector/application/analyze.py`
- Modify: `src/setvector/cli/__init__.py`
- Create: `tests/test_application_analyze.py`
- Modify: `tests/test_cli.py`

**Interfaces:**
- Consumes: `inspect_audio()`, `decode_audio()`, `baseline_identity()`, `extract_baseline()`, `compute_feature_id()`, and `ArtifactStore`.
- Produces: immutable `AnalysisOutcome(asset: AudioAsset, features: FeatureBundle, manifest_path: Path, cache_hit: bool)`.
- Produces: `analyze_track(path: str | Path, config: AnalysisConfig, store: ArtifactStore) -> AnalysisOutcome`.
- Produces CLI: `setvector analyze <audio-path> --config <config.json> --workspace <directory>`.
- Successful CLI stdout is exactly one JSON object with `asset_id`, `feature_id`, `cache_hit`, and absolute `manifest_path`. Warnings are one per line on stderr.
- `InputError`, `UnsupportedAudioError`, argument errors, and configuration errors map to exit 2. `DecodeError`, `AnalysisError`, and `ArtifactError` map to exit 1. Expected failures have no traceback.

- [x] **Step 1: Write failing application cache tests**

```python
def test_analyze_track_writes_then_reuses_feature_artifact(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    first = analyze_track(tone_path, config, store)
    second = analyze_track(tone_path, config, store)
    assert not first.cache_hit
    assert second.cache_hit
    assert second.features == first.features
    assert second.manifest_path == first.manifest_path


def test_cache_hit_does_not_decode_or_extract(monkeypatch, tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    analyze_track(tone_path, config, store)
    monkeypatch.setattr("setvector.application.analyze.decode_audio", unexpected_call)
    monkeypatch.setattr("setvector.application.analyze.extract_baseline", unexpected_call)
    assert analyze_track(tone_path, config, store).cache_hit
```

Also prove that changed audio bytes and a changed configuration create different feature IDs, and a corrupt existing artifact raises `ArtifactError` rather than being recomputed over.

- [x] **Step 2: Write failing CLI success and error-mapping tests**

```python
def test_analyze_cli_emits_machine_json(tmp_path, tone_path, config_path):
    workspace = Path("relative analysis workspace")
    result = run_cli(
        "analyze",
        str(tone_path),
        "--config",
        str(config_path),
        "--workspace",
        str(workspace),
        cwd=tmp_path,
    )
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert set(output) == {"asset_id", "feature_id", "cache_hit", "manifest_path"}
    assert Path(output["manifest_path"]).is_absolute()
    assert Path(output["manifest_path"]).is_file()


@pytest.mark.parametrize("filename, expected_code", [("missing.wav", 2), ("corrupt.wav", 2)])
def test_analyze_cli_maps_expected_input_errors_without_traceback(
    tmp_path, config_path, filename, expected_code
):
    if filename == "corrupt.wav":
        (tmp_path / filename).write_bytes(b"not an audio file")
    result = run_cli(
        "analyze", filename, "--config", str(config_path), "--workspace", str(tmp_path / "out"), cwd=tmp_path
    )
    assert result.returncode == expected_code
    assert result.stdout == ""
    assert "error:" in result.stderr
    assert "Traceback" not in result.stderr
```

Add a second invocation assertion for `cache_hit=true`, a Unicode/space path, invalid configuration returning 2, and a monkeypatched application error returning 1 when `main([...])` is called directly.

- [x] **Step 3: Run application and CLI tests and confirm they fail**

Run: `python -m pytest tests/test_application_analyze.py tests/test_cli.py -q`

Expected: FAIL because the application service and `analyze` parser are absent.

- [x] **Step 4: Implement cache-first orchestration**

```python
def analyze_track(path: str | Path, config: AnalysisConfig, store: ArtifactStore) -> AnalysisOutcome:
    asset = inspect_audio(path)
    extractor = baseline_identity(config)
    feature_id = compute_feature_id(asset.asset_id, extractor)
    cached = store.load(feature_id, asset)
    if cached is not None:
        return AnalysisOutcome(asset, cached, store.manifest_path(feature_id), True)
    decoded = decode_audio(path, asset, config)
    measurements = extract_baseline(decoded, config)
    bundle = FeatureBundle(
        feature_id=feature_id,
        asset_id=asset.asset_id,
        config_id=config.config_id,
        extractor=extractor,
        measurements=measurements,
    )
    manifest_path = store.save(asset, bundle)
    return AnalysisOutcome(asset, bundle, manifest_path, False)
```

- [x] **Step 5: Refactor the CLI into explicit command handlers**

Create `_load_config(path: Path) -> AnalysisConfig` using the existing duplicate-key hook, `_run_config_validate(args) -> int`, and `_run_analyze(args) -> int`. Add the parser without putting decoding, feature, or artifact logic in `cli`. Resolve the artifact workspace in `ArtifactStore`, print compact sorted JSON to stdout, and print warnings to stderr after success. For exit-1 exceptions print `setvector: error: <message>` and return 1; let `argparse.ArgumentParser.error()` produce exit 2 for caller/configuration errors.

- [x] **Step 6: Run focused and full tests**

Run: `python -m pytest tests/test_application_analyze.py tests/test_cli.py -q`

Expected: PASS.

Run: `python -m pytest -q`

Expected: PASS.

- [x] **Step 7: Lint and commit**

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

```bash
git add src/setvector/application src/setvector/cli tests/test_application_analyze.py tests/test_cli.py
git commit -m "feat(cli): add local audio analysis workflow"
```

---

### Task 6: Offline installed-package verification and usage documentation

**Files:**
- Create: `tests/test_offline_analysis.py`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `docs/implementation-plan.md`

**Interfaces:**
- Consumes the installed `python -m setvector analyze` interface from Task 5.
- Verifies no socket connection can occur while the command produces and reuses a valid local artifact.
- Documents that runtime analysis is local and model-free, while initial package installation can require downloading wheels.

- [ ] **Step 1: Add the failing socket-blocked subprocess test**

```python
def test_analyze_and_cache_work_with_network_sockets_blocked(tmp_path, tone_path, config_path):
    blocker = tmp_path / "network_blocker"
    blocker.mkdir()
    (blocker / "sitecustomize.py").write_text(
        """import socket
def blocked(*args, **kwargs):
    raise AssertionError('network access attempted')
socket.create_connection = blocked
socket.socket.connect = blocked
socket.socket.connect_ex = blocked
""",
        encoding="utf-8",
    )
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(blocker)
    workspace = tmp_path / "offline workspace"
    command = [
        sys.executable,
        "-m",
        "setvector",
        "analyze",
        str(tone_path),
        "--config",
        str(config_path),
        "--workspace",
        str(workspace),
    ]
    first = subprocess.run(command, cwd=tmp_path, env=environment, capture_output=True, text=True)
    second = subprocess.run(command, cwd=tmp_path, env=environment, capture_output=True, text=True)
    assert first.returncode == 0, first.stderr
    assert json.loads(first.stdout)["cache_hit"] is False
    assert second.returncode == 0, second.stderr
    assert json.loads(second.stdout)["cache_hit"] is True
```

- [ ] **Step 2: Run the offline test before documentation changes**

Run: `python -m pytest tests/test_offline_analysis.py -q`

Expected: PASS only when the full workflow makes no socket connection; otherwise FAIL with `network access attempted`.

- [ ] **Step 3: Document the working local command and artifact outputs**

Add this shape to `README.md` and expand it in `docs/development.md`:

```powershell
setvector analyze "C:\Music\track.wav" `
  --config examples/analysis-config.json `
  --workspace .setvector
```

Document the stdout fields, stderr warnings, cache reuse, supported SoundFile-backed formats, M4A/AAC limitation, in-memory track loading, and the `assets/` plus `features/` workspace layout. State plainly that analysis uses NumPy, SoundFile, librosa, SciPy, and soxr on the local machine and requires no GPT model, API key, cloud service, telemetry, or network access after installation. State separately that installing wheels can require internet and an air-gapped wheel bundle is future distribution work. Update the ingestion milestone in `docs/implementation-plan.md` to describe the implemented command without claiming charts or energy scoring exist.

- [ ] **Step 4: Run the complete source-tree verification**

Run: `python -m pytest -q`

Expected: PASS.

Run: `python -m ruff check src tests && python -m ruff format --check src tests`

Expected: PASS.

- [ ] **Step 5: Build and inspect distributions**

Run: `python -m build`

Expected: one sdist and one wheel under `dist/`.

Run: `python -c "import zipfile, pathlib; wheel=next(pathlib.Path('dist').glob('*.whl')); names=zipfile.ZipFile(wheel).namelist(); assert any(n.endswith('setvector/application/analyze.py') for n in names); assert any(n.endswith('setvector/storage/artifacts.py') for n in names); print(wheel)"`

Expected: prints the wheel path without an assertion failure.

- [ ] **Step 6: Verify the wheel outside the checkout with sockets blocked**

```powershell
py -3.11 -m venv <scratch>\wheel-check
<scratch>\wheel-check\Scripts\python.exe -m pip install --no-deps (Get-ChildItem dist\*.whl | Select-Object -First 1).FullName
<scratch>\wheel-check\Scripts\python.exe -m pip install numpy==2.4.6 scipy==1.17.1 soundfile==0.14.0 librosa==0.11.0 soxr==1.1.0
```

From a temporary directory outside the checkout, generate a short WAV with the clean environment, add the socket-blocking `sitecustomize.py`, and run the installed `setvector analyze` command twice. Expected: both runs exit 0, the first reports `cache_hit=false`, the second reports `cache_hit=true`, and the manifest exists. Then run `pip check`; expected: `No broken requirements found.` `<scratch>` is a temporary directory outside the checkout.

Also analyze a generated 6-minute stereo 44.1 kHz WAV with the example configuration and record elapsed time, real-time factor, and peak working-set memory in the commit body. Expected: completes without memory errors; peak memory is dominated by the decoded signal rather than per-frame spectra.

- [ ] **Step 7: Commit documentation and offline verification**

```bash
git add tests/test_offline_analysis.py README.md docs/development.md docs/implementation-plan.md
git commit -m "test(offline): verify model-free audio analysis"
```
