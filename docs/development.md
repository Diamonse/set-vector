# Development

SetVector requires Python 3.11 or newer. The package validates analysis configurations and extracts baseline feature measurements from local audio into a versioned artifact workspace. Interactive reports and energy scoring are the next steps in the [Implementation Plan](implementation-plan.md).

## Setup

Run these commands from the repository root in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/fetch_model.py
.\.venv\Scripts\python.exe -m pip install --no-build-isolation -e .
.\.venv\Scripts\setvector.exe --help
```

Using the virtual environment's executables directly avoids changing PowerShell's execution policy. On macOS or Linux, create the environment with `python3 -m venv .venv` and use `.venv/bin/python` and `.venv/bin/setvector` for the equivalent commands.

`requirements-dev.txt` pins development, build, and runtime dependencies. The runtime dependencies (PyTorch, einops, rotary-embedding-torch, NumPy, SciPy, SoundFile, librosa, and soxr) are pinned exactly in `pyproject.toml` because their versions are part of every artifact's identity.

`src/setvector/analysis/beat_this/` vendors Beat This! 1.1.0's inference code; the `beat-this` package and torchaudio are not installed. `scripts/fetch_model.py` downloads the Beat This! `final0` checkpoint once, verifies its SHA-256, converts it to `src/setvector/models/beat_this-final0.npz` (81 MB), verifies that file's hash, and deletes the checkpoint. It needs PyTorch and NumPy, so run it after installing `requirements-dev.txt`. Git ignores the `.npz`; builds fail without it, and wheels include it. `tests/data/beat_this_reference.npz` holds upstream's output for the parity test; regenerate it only with `scripts/make_beat_this_reference.py`, in the throwaway environment its docstring describes. CPU PyTorch adds about 550 MB to an environment on Windows. On Linux, install with `--extra-index-url https://download.pytorch.org/whl/cpu`, because the default PyPI build of PyTorch includes several gigabytes of CUDA libraries.

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
.\.venv\Scripts\setvector.exe analyze "C:\Music\track.wav" `
  --config examples/analysis-config.json `
  --workspace .setvector
```

On success, standard output contains one JSON object:

| Field | Meaning |
|---|---|
| `asset_id` | SHA-256 of the audio file's bytes |
| `feature_id` | SHA-256 of the asset ID, configuration, extractor parameters, and dependency versions |
| `cache_hit` | `true` when an intact stored baseline feature artifact was reused |
| `manifest_path` | Absolute path of the feature manifest |
| `rhythm_id` | SHA-256 of the feature ID and the rhythm extractor identity |
| `rhythm_source` | `beat_this`, `setvector_fallback`, or `none` |
| `rhythm_reliable` | `true` when the chosen grid passed its checks |
| `downbeat_count` | Number of grid beats at bar position 1 |

`cache_hit` covers only the baseline feature artifact; the audio is still decoded whenever the rhythm artifact is missing, even on a feature cache hit. Warnings, such as a clip shorter than one frame or a decoder-reported length that differs from the decoded audio, go to standard error after the JSON, followed by a "no reliable beat grid" warning naming the rejection reasons whenever `rhythm_reliable` is `false`. Invalid arguments, configurations, paths, and unsupported audio exit with code 2. Decode, extraction, and artifact-integrity failures exit with code 1, including a missing or altered Beat This! weights file. Neither prints a traceback.

Moving or renaming a file reuses its features because identity comes from content, not path. Changing the audio bytes, configuration, SetVector version, extractor algorithm version, or a pinned dependency creates a new feature ID. A corrupt or incomplete stored artifact is reported and never silently overwritten; delete that feature directory to recompute it.

### Supported audio

SoundFile's bundled libsndfile decides support from file content, not the extension: WAV, FLAC, OGG, AIFF, and MP3 are supported. M4A/AAC needs a separate decoder and is not yet supported. Samples are decoded as `float32` without peak or loudness normalization. A track is loaded fully into memory, while frame measurements and tempo estimation are processed in bounded chunks. On a 6-minute stereo 44.1 kHz track with the example configuration, analysis takes about 4 to 5 seconds and peaks below 500 MB, including about 210 MB of library imports. For MP3s without a Xing/Info header, the decoder's reported length is an estimate that can include tag data such as album art; all timing uses the decoded audio, and a warning appears when the two differ by more than 0.25 s.

### Measurements

Frames are left-aligned, contain exactly `frame_length` samples, and start every `hop_length` samples. A trailing partial frame is omitted and counted in the diagnostics. Each series has a timestamp at the frame center plus window start and end times, in seconds from the start of the source.

| Feature | Unit | Definition |
|---|---|---|
| `rms` | `linear_amplitude` | Root mean square of unwindowed samples across retained channels; not LUFS |
| `spectral_centroid` | `Hz` | Magnitude-weighted mean frequency of the Hann-windowed spectrum; missing for silent frames |
| `bass_power_ratio` | `ratio` | Spectral power at or below 250 Hz divided by total power; missing for silent frames |
| `onset_strength` | `normalized_flux` | Positive spectral flux divided by the track's peak flux |

Tempo and beats come from librosa's beat tracker applied to a separately normalized onset envelope: positive spectral flux over bins at or below 150 Hz, normalized to its own track peak. The stored `onset_strength` series stays full-band and keeps its own normalization, so it does not change meaning. Beat times match feature frame timestamps. Beats are kept across the whole track, including quieter intros and outros; librosa's default trimming of weak leading and trailing beats is disabled. The tempo is a candidate estimate, not a confidence-rated pulse: the tracker reports a tempo for any onset envelope that is not constant, including steady tones and noise. Both onset series are normalized per track, so neither can be compared across tracks.

### Workspace layout

```text
<workspace>/
  assets/<asset-id>/asset.json
  features/<feature-id>/manifest.json
  features/<feature-id>/arrays.npz
  rhythm/<rhythm-id>/rhythm.json
```

JSON files hold identities, configuration, beats, and diagnostics. The NPZ file holds dense arrays and validity masks and is loaded without pickle support. Artifacts are written to a temporary sibling directory, verified, and published with one rename. The source audio is never copied or modified.

`rhythm.json` holds the chosen beat grid (constant-tempo segments, grid beats, and their bar positions), the detector's raw beats, each candidate's quality measurements, and the reasons any candidate was rejected. Its source is `beat_this`, `setvector_fallback` (beats without bars), or `none`.

## Report

```powershell
.\.venv\Scripts\setvector.exe report <feature-id> --workspace .setvector
```

| Option | Meaning |
|---|---|
| `feature_id` | Feature ID printed by `analyze` |
| `--workspace` | Directory holding analysis artifacts (required) |
| `--output` | HTML file to write; defaults to `<workspace>/reports/<feature-id>.html` |
| `--audio` | Current path of the analyzed audio file, if it moved since `analyze` ran |
| `--no-audio` | Build the report without a player; mutually exclusive with `--audio` |
| `--overwrite` | Replace an existing report file |

`report` never reanalyzes audio; it renders the stored feature artifact. When a reliable rhythm analysis exists for that feature artifact, the report draws bar lines at its detected downbeats and uses its grid beats and tempo. Otherwise it falls back to the baseline tracker's beats with no bar lines and adds one warning explaining why: no rhythm analysis matches the feature artifact, the chosen grid failed its reliability checks (naming the reasons), or the chosen grid has beats but no downbeats. On success, standard output contains one JSON object:

| Field | Meaning |
|---|---|
| `audio` | `"embedded"` when a player was included, `"none"` otherwise |
| `feature_id` | Feature ID the report was built from |
| `report_path` | Absolute path of the written HTML file |

Unless `--no-audio` is given, `report` reads the audio file at `--audio`, or otherwise the path recorded at analysis time, and hashes its bytes. The report is refused if that hash does not match the analyzed asset; the error suggests passing `--audio <path>` to the moved file or `--no-audio` to skip the player. A file already encoded as MP3/MPEG Layer III is embedded unchanged; any other source (including MP3 files using a different MPEG layer) is decoded from the verified bytes and converted to an MP3 preview in memory, without touching the source file. During that conversion the sample rate is resampled only when it is not one MP3 natively supports, to the next legal rate up to a maximum of 48 kHz, and audio with more than two channels is downmixed to mono; stereo and mono sources keep their channel count. The report's title comes from the filename recorded when the audio was first analyzed, not from the file passed to `--audio`.

By default, `report` refuses to replace an existing output file; pass `--overwrite` to replace it. Invalid arguments, an unknown or malformed feature ID, both `--audio` and `--no-audio`, an existing output without `--overwrite`, missing audio at the recorded path, and audio content that does not match the analyzed asset all exit with code 2. Corrupt stored artifacts and decode, encode, or write failures exit with code 1. Neither prints a traceback, and a failed run leaves no partial report file.

The generated page is a single self-contained HTML file: the model data, the audio (when embedded), the vendored [uPlot](https://github.com/leeoniya/uPlot) chart library, and the Inter variable font are all inlined, so it opens with no network access and no other files. A report without audio for a 6-minute track is about 1.2 MB; with audio it is roughly the embedded MP3 size times 1.33 plus about 1.2 MB. uPlot is MIT-licensed and the Inter font is licensed under the SIL Open Font License 1.1; both license texts ship alongside the package under `visualization/assets/LICENSES/`. Because the analyzed track is embedded in the file, share or move a report the way you would the music file itself.

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
