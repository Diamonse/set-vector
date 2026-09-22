# Audio Analysis Pipeline

## Objective

Implement one complete local workflow that accepts an audio file, extracts a documented baseline feature set, saves versioned artifacts, and returns an identifier that later reporting and energy models can reuse.

```text
audio file
  -> content identity and metadata
  -> explicit decode policy
  -> aligned feature measurements
  -> atomic local artifacts
  -> feature ID
```

This stage delivers ingestion and feature artifacts. Interactive reports, energy scoring, transition comparison, and set planning remain later stages.

## Offline requirement

The installed application performs analysis without GPT access, API keys, hosted models, telemetry, or network requests. NumPy, SoundFile, and librosa run locally. Artifacts are written to a local workspace.

Once dependencies are installed, the full `analyze` command must pass an integration test that blocks Python socket connections. Package metadata and source imports must contain no required cloud or language-model client. Future hosted integrations must be optional adapters outside this workflow.

Initial installation may download Python wheels. Producing an air-gapped wheel bundle is a separate distribution task.

## Audio support

SoundFile is the decoder boundary. A file is accepted when the installed SoundFile/libsndfile backend can inspect and decode its contents. The initial target is WAV, FLAC, OGG, AIFF, and MP3 when the backend reports MP3 support. M4A/AAC requires a later decoder adapter.

Validation uses the file header and decoder result rather than trusting the extension. Unsupported, missing, empty, and corrupt files return clear errors without creating a completed artifact.

The decoder reads `float32` samples with an explicit channel dimension and never peak-normalizes or loudness-normalizes them. `sample_rate=null` preserves the native rate. A configured rate uses a recorded local resampling implementation.

Channel policies have these meanings:

- `mono`: average channel waveforms before feature extraction.
- `preserve`: keep channels through framing; scalar amplitude and spectral features aggregate channel measurements or channel power without mixing the waveforms together.

The first implementation loads a track into memory. Long-recording block processing is added only when measured workloads require it.

## Asset identity

`AudioAsset` contains:

- schema version
- SHA-256 content ID computed from the original file bytes
- absolute observed path for diagnostics
- byte size
- duration in seconds
- native sample rate
- channel count
- decoder-reported format and subtype

The content hash is the asset identity. The observed path does not participate in the ID. The source audio is never copied into or modified by the analysis workspace.

## Extractor identity

The first extractor is named `baseline-v1`. Its identity records:

- SetVector package version
- extractor schema and algorithm version
- effective `AnalysisConfig`
- fixed algorithm parameters, including a 250 Hz bass cutoff and Hann spectral window
- NumPy, SoundFile, librosa, SciPy, and resampler versions used by the environment

Changing any identity input creates a different feature ID. Model weights and energy calibration are not part of this stage.

## Frame timing

Frames are left-aligned and never implicitly centered. Full windows begin every `hop_length` samples. Only windows containing `frame_length` source samples are measured. A final partial tail is omitted and its sample count is recorded in diagnostics. A clip shorter than one frame produces empty series and a warning rather than invented padded measurements.

For frame index `i`:

```text
start_sample = i * hop_length
end_sample = start_sample + frame_length
timestamp = (start_sample + frame_length / 2) / sample_rate
```

Every series stores timestamps, window starts, window ends, values, units, and validity using `FeatureSeries`.

## Baseline features

The stage produces four aligned scalar series:

| Feature | Unit | Definition |
|---|---|---|
| RMS | `linear_amplitude` | Root mean square over unwindowed frame samples and retained channels |
| Spectral centroid | `Hz` | Frequency centroid from the Hann-windowed magnitude spectrum averaged across retained channels |
| Bass power ratio | `ratio` | Power at or below 250 Hz divided by total frame power |
| Onset strength | `normalized_flux` | Nonnegative spectral-flux envelope aligned to the common frame grid |

Silence has valid RMS and onset values of zero. Spectral centroid and bass ratio are missing where total spectral energy is zero. Missing values use `None` with `validity=False`; zero remains a valid measurement.

Tempo and beat positions are track-level outputs derived from the onset envelope. No detected pulse is represented by `tempo_bpm=None` and an empty beat list. Beat positions are seconds from the beginning of the decoded source and retain their corresponding frame indices.

## Feature bundle

`FeatureBundle` contains:

- feature ID
- asset ID
- configuration ID and effective configuration
- extractor identity and dependency versions
- the four feature series
- tempo and beat positions
- diagnostics and warnings
- feature schema version

The feature ID is SHA-256 over canonical JSON containing the asset ID, configuration, extractor parameters, and dependency versions. It does not include source paths or workspace locations.

## Local artifact store

The workspace uses this layout:

```text
<workspace>/
  assets/<asset-id>/asset.json
  features/<feature-id>/manifest.json
  features/<feature-id>/arrays.npz
```

JSON stores schemas, identities, metadata, summaries, and diagnostics. NumPy NPZ stores dense numerical arrays and validity masks. NPZ loading disables pickled objects. Missing numeric observations are stored as a numeric placeholder plus a separate boolean validity array and reconstructed as `None` at the domain boundary.

Writes occur in a temporary sibling directory. The store validates every completed file before an atomic rename publishes the artifact. A partial directory is never a cache hit. Existing corrupt or incompatible artifacts raise an artifact error and are not silently overwritten.

An unchanged audio file, configuration, extractor, and dependency environment return the existing feature artifact. The outcome reports `cache_hit=true`. A change to any identity input produces a new feature ID and artifact.

## Application API and CLI

The application service is:

```text
analyze_track(path, config, store) -> AnalysisOutcome
```

`AnalysisOutcome` contains the `AudioAsset`, `FeatureBundle`, manifest path, and cache-hit state.

The CLI command is:

```text
setvector analyze <audio-path> --config <config.json> --workspace <directory>
```

Successful output is one JSON object on standard output containing `asset_id`, `feature_id`, `cache_hit`, and `manifest_path`. Human-readable warnings go to standard error. Paths with spaces and Unicode are supported.

Invalid arguments, configuration, paths, and unsupported audio return exit code 2. Decode, extraction, and artifact-integrity failures return exit code 1. Expected failures do not print Python tracebacks.

## Module boundaries

| Module | Responsibility |
|---|---|
| `domain` | `AudioAsset`, `FeatureBundle`, diagnostics, and immutable contracts |
| `ingestion` | Content hashing, decoder inspection, decode and resample policy |
| `analysis` | Framing, feature calculations, tempo and beat extraction |
| `storage` | Canonical identities, atomic artifact writes, validated loads and cache lookup |
| `application` | Orchestrate ingestion, extraction, persistence, and cache outcomes |
| `cli` | Parse paths/options, map failures to exit codes, emit JSON |

Numerical analysis has no filesystem access. Storage has no signal-processing decisions. The CLI contains no decoding or feature logic.

## Verification

Tests use generated audio that can be redistributed:

- silence for valid zero amplitude and missing spectral ratios
- sine waves for duration, timing, centroid, bass ratio, and channel behavior
- click tracks for onset, tempo, and beat behavior
- stereo anti-phase signals to distinguish `mono` from `preserve`
- clips shorter than one frame and clips with partial tails
- corrupt, empty, missing, and unsupported files
- Unicode and space-containing paths
- repeated analysis for cache reuse
- configuration and audio changes for cache invalidation
- interrupted or corrupt artifacts for cache rejection
- installed-wheel execution with Python socket connections blocked

The full suite, Ruff checks, package build, and clean-wheel installation must pass before the local commit.

## Delegation

Implementation work has non-overlapping ownership:

- A high-reasoning numerical agent owns `analysis` and its focused tests.
- A balanced coding agent owns `ingestion` and its focused tests.
- A reliable implementation agent owns `storage` and its focused tests.
- The primary agent owns shared domain contracts, application orchestration, CLI integration, dependency configuration, documentation, and full-suite verification.

The most capable available reasoning model performs the final whole-change review.
