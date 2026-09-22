# Development

SetVector requires Python 3.11 or newer. The package currently provides analysis configuration validation and scalar feature data types. Audio extraction and interactive reports are the next steps in the [Implementation Plan](implementation-plan.md).

## Setup

Run these commands from the repository root in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip install --no-build-isolation -e .
.\.venv\Scripts\setvector.exe --help
```

Using the virtual environment's executables directly avoids changing PowerShell's execution policy. On macOS or Linux, create the environment with `python3 -m venv .venv` and use `.venv/bin/python` and `.venv/bin/setvector` for the equivalent commands.

`requirements-dev.txt` pins development and build dependencies. Runtime dependencies will be added with the audio pipeline; the current library uses the standard library.

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
