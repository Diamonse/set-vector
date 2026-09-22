# Development

SetVector requires Python 3.11 or newer. The package validates analysis configurations and extracts baseline feature measurements from local audio into a versioned artifact workspace. Interactive reports and energy scoring are the next steps in the [Implementation Plan](implementation-plan.md).

## Setup

Run these commands from the repository root in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip install --no-build-isolation -e .
.\.venv\Scripts\setvector.exe --help
```

Using the virtual environment's executables directly avoids changing PowerShell's execution policy. On macOS or Linux, create the environment with `python3 -m venv .venv` and use `.venv/bin/python` and `.venv/bin/setvector` for the equivalent commands.

`requirements-dev.txt` pins development, build, and runtime dependencies. The runtime dependencies (NumPy, SciPy, SoundFile, librosa, and soxr) are pinned exactly in `pyproject.toml` because their versions are part of every feature artifact's identity.

Installing the package downloads wheels from a package index. After installation, analysis needs no network access, GPT model, API key, cloud service, or telemetry. An air-gapped wheel bundle is future distribution work.

## Configuration

Validate a JSON configuration:

```powershell
.\.venv\Scripts\setvector.exe config validate examples/analysis-config.json
```

Successful validation writes a JSON object containing `config` and its deterministic `config_id` to standard output. Invalid files write a diagnostic to standard error and return exit code 2. Validation does not analyze audio.

All five fields are required in configuration files:

| Field | Meaning |
|---|---|
| `schema_version` | Configuration schema; currently `1` |
| `sample_rate` | Positive integer in Hz, or `null` to preserve the native rate |
| `frame_length` | Positive number of samples per analysis window |
| `hop_length` | Positive sample interval between windows; at most `frame_length` |
| `channel_policy` | `mono` or `preserve` |

Unknown fields, duplicate keys, and unsupported schema versions are rejected. The example's window sizes are starting values for experimentation, not a calibrated energy model. `config_id` identifies only the configuration; a future analysis artifact also needs the audio, extractor, and environment identities described in [Architecture](architecture.md).

## Analyze audio

```powershell
.\.venv\Scripts\setvector.exe analyze "C:\Music	rack.wav" `
  --config examples/analysis-config.json `
  --workspace .setvector
```

On success, standard output contains one JSON object:

| Field | Meaning |
|---|---|
| `asset_id` | SHA-256 of the audio file's bytes |
| `feature_id` | SHA-256 of the asset ID, configuration, extractor parameters, and dependency versions |
| `cache_hit` | `true` when an intact stored artifact was reused without decoding the audio |
| `manifest_path` | Absolute path of the feature manifest |

Warnings, such as a clip shorter than one frame, go to standard error after the JSON. Invalid arguments, configurations, paths, and unsupported audio exit with code 2. Decode, extraction, and artifact-integrity failures exit with code 1. Neither prints a traceback.

Moving or renaming a file reuses its features because identity comes from content, not path. Changing the audio bytes, configuration, SetVector version, or a pinned dependency creates a new feature ID. A corrupt or incomplete stored artifact is reported and never silently overwritten; delete that feature directory to recompute it.

### Supported audio

SoundFile's bundled libsndfile decides support from file content, not the extension: WAV, FLAC, OGG, AIFF, and MP3 are supported. M4A/AAC needs a separate decoder and is not yet supported. Samples are decoded as `float32` without peak or loudness normalization. A track is loaded fully into memory, while frame measurements and tempo estimation are processed in bounded chunks. On a 6-minute stereo 44.1 kHz track with the example configuration, analysis takes about 4 to 5 seconds and peaks below 500 MB, including about 210 MB of library imports.

### Measurements

Frames are left-aligned, contain exactly `frame_length` samples, and start every `hop_length` samples. A trailing partial frame is omitted and counted in the diagnostics. Each series has a timestamp at the frame center plus window start and end times, in seconds from the start of the source.

| Feature | Unit | Definition |
|---|---|---|
| `rms` | `linear_amplitude` | Root mean square of unwindowed samples across retained channels; not LUFS |
| `spectral_centroid` | `Hz` | Magnitude-weighted mean frequency of the Hann-windowed spectrum; missing for silent frames |
| `bass_power_ratio` | `ratio` | Spectral power at or below 250 Hz divided by total power; missing for silent frames |
| `onset_strength` | `normalized_flux` | Positive spectral flux divided by the track's peak flux |

Tempo and beats come from librosa's beat tracker applied to the onset envelope, and beat times match feature frame timestamps. The tempo is a candidate estimate, not a confidence-rated pulse: the tracker reports a tempo for any onset envelope that is not constant, including steady tones and noise. Onset strength is normalized per track, so it cannot be compared across tracks.

### Workspace layout

```text
<workspace>/
  assets/<asset-id>/asset.json
  features/<feature-id>/manifest.json
  features/<feature-id>/arrays.npz
```

JSON files hold identities, configuration, beats, and diagnostics. The NPZ file holds dense arrays and validity masks and is loaded without pickle support. Artifacts are written to a temporary sibling directory, verified, and published with one rename. The source audio is never copied or modified.

## Python API

```python
import json
from pathlib import Path

from setvector import AnalysisConfig, FeatureSeries

config = AnalysisConfig.from_dict(
    json.loads(Path("examples/analysis-config.json").read_text(encoding="utf-8"))
)
print(config.config_id)

feature = FeatureSeries(
    name="rms",
    unit="linear_amplitude",
    timestamps=(0.5, 1.5),
    values=(0.2, None),
    validity=(True, False),
    window_starts=(0.0, 1.0),
    window_ends=(1.0, 2.0),
)
restored = FeatureSeries.from_dict(json.loads(json.dumps(feature.to_dict())))
assert restored == feature
```

Analyze a track from Python with the same services the CLI uses:

```python
from setvector.application import analyze_track
from setvector.storage import ArtifactStore

outcome = analyze_track("track.wav", config, ArtifactStore(".setvector"))
print(outcome.features.feature_id, outcome.cache_hit)
print(outcome.features.measurements.tempo_bpm)
```

Feature series store scalar observations with immutable tuples. Times are seconds from the start of the source. Each timestamp must lie within its positive-width window, and timestamps must increase strictly. Array lengths must match. Missing observations use `None` with `validity=False`; valid values must be finite. Zero remains a valid measured value. Multidimensional features will need a separate contract when introduced.

## Checks

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m build --no-isolation
```

Tests run against the installed package using pytest's import mode. Install the built wheel into a separate environment and run its CLI outside the repository before making packaging changes available to others. This catches missing distribution files that an editable install can hide.

Keep music files and generated analysis workspaces out of Git. Commit focused changes locally with Conventional Commit subjects and no trailers, following `../AGENTS.md`.
