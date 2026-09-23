# Rhythm Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every analyzed track a fitted beat grid with real downbeats, stored as a separate rhythm artifact, using Beat This! as a required detector and a bass-band fix of SetVector's own tracker as the fallback.

**Architecture:** `analyze_track` keeps producing the baseline feature artifact and additionally produces `rhythm/<rhythm_id>/rhythm.json`. `analysis/beat_this.py` is the only PyTorch module and loads a bundled, hash-verified checkpoint. `analysis/grid.py` fits piecewise-constant tempo grids. `analysis/rhythm.py` scores candidates and selects `beat_this`, `setvector_fallback`, or `none`. Reports draw bar lines from the rhythm artifact's downbeats.

**Tech Stack:** Python 3.11+, NumPy, librosa, Beat This! 1.1.0 on CPU PyTorch, hatchling with a custom build hook, pytest, Ruff.

**Spec:** [Rhythm Engine Design](../specs/2026-09-23-rhythm-engine-design.md)

---

## Conventions for every task

- Work on branch `feat/rhythm-engine` (the spec commits are already there), ideally in a worktree created with superpowers:using-git-worktrees.
- Commands are PowerShell from the repository root with the project venv: `.\.venv\Scripts\python.exe`. Abbreviated below as `py`, meaning `.\.venv\Scripts\python.exe`.
- Commit messages follow Conventional Commits. **Do not add any trailer** (no `Co-authored-by`, no assistant attribution) — `AGENTS.md` forbids them.
- After each task: `py -m pytest -q` and `py -m ruff check .` and `py -m ruff format --check .` must pass before committing, unless the task says otherwise.
- Never commit `src/setvector/models/beat_this-final0.ckpt` (it is Git-ignored from Task 2 on).

## File map

| File | Status | Responsibility |
|---|---|---|
| `pyproject.toml`, `requirements-dev.txt` | modify | Pin Beat This!/PyTorch; include checkpoint in builds; build hook |
| `hatch_build.py` | create | Refuse builds without the verified checkpoint |
| `scripts/fetch_model.py` | create | Download and verify the checkpoint into the package |
| `.gitignore` | modify | Ignore the checkpoint and partial downloads |
| `src/setvector/models/__init__.py`, `checkpoint.py`, `LICENSE-beat-this` | create | Checkpoint identity (no SetVector imports) and license |
| `src/setvector/domain/errors.py`, `domain/__init__.py`, `setvector/__init__.py` | modify | `InstallationError`; export rhythm types |
| `src/setvector/analysis/identity.py` | modify | Baseline v3 parameters; rhythm constants and `rhythm_identity` |
| `src/setvector/analysis/baseline.py` | modify | Bass-band beat onset envelope |
| `src/setvector/storage/publish.py` | create | Shared atomic publish and JSON helpers |
| `src/setvector/storage/artifacts.py` | modify | Use `publish.py` |
| `src/setvector/analysis/grid.py` | create | Piecewise-constant grid fitting |
| `src/setvector/domain/rhythm.py` | create | `GridSegment`, `CandidateQuality`, `RhythmAnalysis` |
| `src/setvector/storage/canonical.py`, `storage/__init__.py` | modify | `compute_rhythm_id`; exports |
| `src/setvector/storage/rhythm.py` | create | `RhythmStore` |
| `src/setvector/analysis/beat_this.py` | create | Checkpoint verification, detection, peak refinement |
| `src/setvector/analysis/rhythm.py`, `analysis/__init__.py` | create/modify | Candidate scoring and source selection |
| `src/setvector/application/analyze.py`, `application/report.py` | modify | Rhythm stage; report input |
| `src/setvector/cli/__init__.py` | modify | Rhythm fields in `analyze` output |
| `src/setvector/visualization/model.py`, `assets/report.js` | modify | Rhythm beats/downbeats; no fake bars |
| `tests/conftest.py` | modify | `real_model` marker, Beat This! stub, rhythm factory |
| `tests/test_*.py` | create/modify | Listed per task |
| `docs/architecture.md`, `docs/research/analysis-engine-extension.md`, `docs/development.md`, `README.md` | modify | Required model, setup, workspace layout |

---

### Task 1: Pin Beat This! and CPU PyTorch

**Files:**
- Modify: `pyproject.toml` (the `dependencies` list)
- Modify: `requirements-dev.txt`

- [ ] **Step 1: Replace the dependency list in `pyproject.toml`**

```toml
dependencies = [
    "beat-this==1.1.0",
    "einops==0.8.2",
    "librosa==0.11.0",
    "numpy==2.4.6",
    "rotary-embedding-torch==0.9.1",
    "scipy==1.17.1",
    "soundfile==0.14.0",
    "soxr==1.1.0",
    "torch==2.14.0",
    "torchaudio==2.11.0",
]
```

These versions ran Beat This! together in the spike (torch was the `+cpu` build; `==2.14.0` accepts it). On Windows and macOS the PyPI `torch` wheel is CPU-only. On Linux use `--extra-index-url https://download.pytorch.org/whl/cpu` to avoid the CUDA build.

- [ ] **Step 2: Add the same pins to `requirements-dev.txt`**

Add these lines in alphabetical position:

```text
beat-this==1.1.0
einops==0.8.2
rotary-embedding-torch==0.9.1
torch==2.14.0
torchaudio==2.11.0
```

- [ ] **Step 3: Install and check**

Run:
```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -c "import torch, torchaudio, beat_this, einops, rotary_embedding_torch; print(torch.__version__, torch.cuda.is_available())"
```
Expected: `pip check` prints `No broken requirements found.`; the last line prints `2.14.0... False` on this Windows machine.

If `pip check` reports a torch/torchaudio conflict, STOP and report it with the exact output. Do not pick other versions by guesswork.

- [ ] **Step 4: Pin the new transitive dependencies**

Run `.\.venv\Scripts\python.exe -m pip freeze` and add to `requirements-dev.txt`, with their exact `==` versions, every package that is now installed but not yet listed (expected: `filelock`, `fsspec`, `Jinja2`, `MarkupSafe`, `mpmath`, `networkx`, `setuptools`, `sympy`, `typing_extensions`, plus anything else pip installed). Keep the file sorted case-insensitively.

- [ ] **Step 5: Run the existing suite**

Run: `py -m pytest -q`
Expected: all existing tests pass (nothing uses the new packages yet).

- [ ] **Step 6: Commit**

```powershell
git add pyproject.toml requirements-dev.txt
git commit -m "build: require Beat This! with CPU PyTorch"
```

---

### Task 2: Bundle the verified checkpoint

**Files:**
- Create: `src/setvector/models/__init__.py`
- Create: `src/setvector/models/checkpoint.py`
- Create: `src/setvector/models/LICENSE-beat-this`
- Create: `scripts/fetch_model.py`
- Create: `hatch_build.py`
- Modify: `.gitignore`, `pyproject.toml`
- Test: `tests/test_model_checkpoint.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_model_checkpoint.py`:

```python
"""The bundled Beat This! checkpoint is present and matches its pinned hash."""

import hashlib

from setvector.models import checkpoint


def test_bundled_checkpoint_matches_pinned_hash():
    assert checkpoint.PATH.is_file(), "missing checkpoint: run python scripts/fetch_model.py"
    assert checkpoint.sha256_file(checkpoint.PATH) == checkpoint.SHA256


def test_sha256_file_reads_large_files_in_blocks(tmp_path):
    data = b"a" * (3 * 2**20 + 5)
    path = tmp_path / "blob.bin"
    path.write_bytes(data)
    assert checkpoint.sha256_file(path) == hashlib.sha256(data).hexdigest()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `py -m pytest tests/test_model_checkpoint.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'setvector.models'`.

- [ ] **Step 3: Create the checkpoint identity module**

`src/setvector/models/__init__.py`:

```python
"""Model files bundled with SetVector."""
```

`src/setvector/models/checkpoint.py`:

```python
"""Identity of the bundled Beat This! checkpoint.

This module imports nothing from SetVector so the build hook and the fetch script
can load it with ``runpy`` before the package is installed.
"""

import hashlib
from pathlib import Path

NAME = "final0"
FILE_NAME = "beat_this-final0.ckpt"
SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt"
PATH = Path(__file__).resolve().parent / FILE_NAME


def sha256_file(path: Path) -> str:
    """Return the lowercase SHA-256 of ``path``, read in 1 MiB blocks."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
```

- [ ] **Step 4: Create the fetch script**

`scripts/fetch_model.py`:

```python
"""Download the Beat This! checkpoint into the package and verify its SHA-256.

Run once in a source checkout before installing or building SetVector:

    python scripts/fetch_model.py
"""

import runpy
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = runpy.run_path(str(ROOT / "src" / "setvector" / "models" / "checkpoint.py"))


def main() -> int:
    target, expected = CHECKPOINT["PATH"], CHECKPOINT["SHA256"]
    sha256_file = CHECKPOINT["sha256_file"]
    if target.is_file() and sha256_file(target) == expected:
        print(f"checkpoint already present: {target}")
        return 0
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".part", delete=False) as part:
        temporary = Path(part.name)
        with urllib.request.urlopen(CHECKPOINT["URL"], timeout=60) as response:
            while block := response.read(1 << 20):
                part.write(block)
    actual = sha256_file(temporary)
    if actual != expected:
        temporary.unlink()
        print(
            f"error: downloaded checkpoint has SHA-256 {actual}, expected {expected}",
            file=sys.stderr,
        )
        return 1
    temporary.replace(target)
    print(f"checkpoint verified: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Ignore the checkpoint in Git**

Append to `.gitignore`:

```text

# Bundled model downloaded by scripts/fetch_model.py
src/setvector/models/*.ckpt
src/setvector/models/*.part
```

- [ ] **Step 6: Fetch the checkpoint and run the tests**

Run:
```powershell
.\.venv\Scripts\python.exe scripts/fetch_model.py
py -m pytest tests/test_model_checkpoint.py -q
git status --short
```
Expected: `checkpoint verified: ...\src\setvector\models\beat_this-final0.ckpt`; 2 passed; `git status` does not list the `.ckpt`.

- [ ] **Step 7: Add the Beat This! license**

Copy the installed license verbatim:
```powershell
$license = .\.venv\Scripts\python.exe -c "import importlib.metadata as m; print(next(f.locate() for f in m.distribution('beat-this').files if f.name == 'LICENSE'))"
Copy-Item $license src\setvector\models\LICENSE-beat-this
```
Open the file and check it is the MIT license naming the Beat This! authors.

- [ ] **Step 8: Add the build hook**

`hatch_build.py` (repository root):

```python
"""Refuse to build SetVector without the verified Beat This! checkpoint."""

import runpy
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CheckpointHook(BuildHookInterface):
    """Fail the build when the bundled checkpoint is missing or altered."""

    def initialize(self, version, build_data):
        checkpoint = runpy.run_path(
            str(Path(self.root) / "src" / "setvector" / "models" / "checkpoint.py")
        )
        path = checkpoint["PATH"]
        if not path.is_file():
            raise RuntimeError(f"missing {path}; run: python scripts/fetch_model.py")
        if checkpoint["sha256_file"](path) != checkpoint["SHA256"]:
            raise RuntimeError(
                f"{path} does not match its pinned SHA-256; rerun scripts/fetch_model.py"
            )
```

- [ ] **Step 9: Wire the hook, the Git-ignored checkpoint, and the license into `pyproject.toml`**

Change `license-files` to:

```toml
license-files = [
    "LICENSE",
    "src/setvector/visualization/assets/LICENSES/*",
    "src/setvector/models/LICENSE-beat-this",
]
```

Add after `[project.scripts]`:

```toml
[tool.hatch.build]
# The checkpoint is Git-ignored; hatch skips ignored files unless listed as artifacts.
artifacts = ["src/setvector/models/*.ckpt"]

[tool.hatch.build.hooks.custom]
```

Add `"/hatch_build.py"` and `"/scripts"` to the `[tool.hatch.build.targets.sdist] include` list.

- [ ] **Step 10: Verify the wheel contains the checkpoint and the build fails without it**

Run:
```powershell
py -m build --no-isolation
py -m zipfile -l (Get-ChildItem dist\*.whl | Sort-Object LastWriteTime | Select-Object -Last 1).FullName | Select-String "ckpt|LICENSE-beat-this"
Rename-Item src\setvector\models\beat_this-final0.ckpt held.ckpt.bak
py -m build --no-isolation --wheel; "exit=$LASTEXITCODE"
Rename-Item src\setvector\models\held.ckpt.bak beat_this-final0.ckpt
```
Expected: the listing shows `setvector/models/beat_this-final0.ckpt` (about 81 MB) and `LICENSE-beat-this` (if the checkpoint appears under `src/setvector/...` or is absent, stop and report the listing); the second build fails with `missing ...beat_this-final0.ckpt; run: python scripts/fetch_model.py` and `exit=1`. Then re-run `py -m pip install --no-build-isolation -e .` so the editable install is current. Delete `dist\` afterwards.

- [ ] **Step 11: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add .gitignore pyproject.toml hatch_build.py scripts/fetch_model.py src/setvector/models/__init__.py src/setvector/models/checkpoint.py src/setvector/models/LICENSE-beat-this tests/test_model_checkpoint.py
git commit -m "build: bundle the verified Beat This! checkpoint"
```

---

### Task 3: Track baseline beats from the bass band

**Files:**
- Modify: `src/setvector/analysis/identity.py`
- Modify: `src/setvector/analysis/baseline.py`
- Test: `tests/test_analysis_baseline.py`

Measured before writing this plan: on the synthetic signal below, the current tracker puts 0% of its beats on the kicks; the bass-band envelope puts 99% there, and the existing click-train tests still pass with it (tempo 120.97, median interval 0.496 s, first intro beat at 0.03 s).

- [ ] **Step 1: Write the failing test**

Add to `tests/test_analysis_baseline.py` after `click_train`:

```python
def kick_and_offbeat_hats(sample_rate=22_050, bpm=125.0, seconds=32.0):
    """Quiet 60 Hz kicks on the beat and louder noise hi-hats on the off-beat."""
    size = int(sample_rate * seconds)
    signal = np.zeros(size)
    period = 60.0 / bpm
    rng = np.random.default_rng(7)
    t = np.arange(int(0.15 * sample_rate)) / sample_rate
    kick = 0.5 * np.sin(2 * np.pi * 60.0 * t) * np.exp(-t / 0.06)
    hat_t = np.arange(int(0.05 * sample_rate)) / sample_rate
    hat = rng.standard_normal(hat_t.size) * np.exp(-hat_t / 0.012)
    kicks = np.arange(0.25, seconds - 0.2, period)
    for beat in kicks:
        start = int(beat * sample_rate)
        signal[start : start + kick.size] += kick[: size - start]
        start = int((beat + period / 2) * sample_rate)
        signal[start : start + hat.size] += hat[: size - start]
    signal = 0.9 * signal / np.abs(signal).max()
    return signal.astype(np.float32)[None, :], kicks


def test_beats_follow_kicks_not_louder_offbeat_hats(decoded_factory):
    samples, kicks = kick_and_offbeat_hats()
    config = AnalysisConfig(
        sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono"
    )
    result = extract_baseline(decoded_factory(samples, 22_050), config)
    beats = np.array([beat.seconds for beat in result.beats])
    on_kick = np.min(np.abs(beats[:, None] - kicks[None, :]), axis=1) <= 0.07
    assert len(beats) >= 60
    assert on_kick.mean() >= 0.9
```

Update `test_baseline_identity_records_parameters_and_environment`: change `assert identity.algorithm_version == 2` to `== 3`, and add `"beat_onset_band_hz": 150.0,` to the expected parameters dict (keep it sorted: after `"bass_cutoff_hz": 250.0,`).

- [ ] **Step 2: Run to verify both fail**

Run: `py -m pytest tests/test_analysis_baseline.py -q -k "kicks or identity"`
Expected: 2 failed — `on_kick.mean()` is `0.0`, and `algorithm_version` is 2.

- [ ] **Step 3: Record the new parameter**

In `src/setvector/analysis/identity.py`, set `ALGORITHM_VERSION = 3`, add below `BASS_CUTOFF_HZ`:

```python
# Beat tracking follows the kick: full-band flux locks to off-beat hi-hats in club music.
BEAT_ONSET_BAND_HZ = 150.0
```

and add `"beat_onset_band_hz": BEAT_ONSET_BAND_HZ,` to `PARAMETERS`.

- [ ] **Step 4: Measure a bass-band envelope in the same pass**

In `src/setvector/analysis/baseline.py`:

Change the import to `from .identity import BASS_CUTOFF_HZ, BEAT_ONSET_BAND_HZ, BEAT_TRIM`.

Add above `_measure_frames`:

```python
def _normalized(flux: np.ndarray) -> np.ndarray:
    peak = flux.max(initial=0.0)
    return flux / peak if peak > 0 else flux
```

Replace `_measure_frames` with:

```python
def _measure_frames(samples: np.ndarray, sample_rate: int, config: AnalysisConfig, frames: int):
    frame_length, hop_length = config.frame_length, config.hop_length
    windows = sliding_window_view(samples, frame_length, axis=1)
    hann = np.hanning(frame_length)
    frequencies = np.fft.rfftfreq(frame_length, d=1 / sample_rate)
    bass_bins = frequencies <= BASS_CUTOFF_HZ
    beat_bins = frequencies <= BEAT_ONSET_BAND_HZ
    rms = np.empty(frames)
    weighted = np.empty(frames)
    magnitude_total = np.empty(frames)
    bass_power = np.empty(frames)
    total_power = np.empty(frames)
    flux = np.zeros(frames)
    beat_flux = np.zeros(frames)
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
        low = magnitude[:, beat_bins]
        if previous is not None:
            flux[first] = np.maximum(magnitude[0] - previous, 0.0).sum()
            beat_flux[first] = np.maximum(low[0] - previous[beat_bins], 0.0).sum()
        flux[first + 1 : last] = np.maximum(np.diff(magnitude, axis=0), 0.0).sum(axis=1)
        beat_flux[first + 1 : last] = np.maximum(np.diff(low, axis=0), 0.0).sum(axis=1)
        previous = magnitude[-1]
    return (
        rms,
        _ratio(weighted, magnitude_total),
        _ratio(bass_power, total_power),
        _normalized(flux),
        _normalized(beat_flux),
    )
```

In `extract_baseline`, replace the measurement block and the beat call:

```python
    if frames == 0:
        warnings.append(
            f"audio has {sample_count} samples, shorter than one {frame_length}-sample frame; "
            "no features were measured"
        )
        rms, centroid, bass, onset, beat_onset = np.empty(0), [], [], np.empty(0), np.empty(0)
    else:
        try:
            rms, centroid, bass, onset, beat_onset = _measure_frames(
                samples, sample_rate, config, frames
            )
        except (FloatingPointError, MemoryError) as error:
            raise AnalysisError(f"feature extraction failed: {error}") from error
    tempo, beats = _estimate_beats(beat_onset, timing[0], sample_rate, hop_length)
```

- [ ] **Step 5: Run the baseline tests**

Run: `py -m pytest tests/test_analysis_baseline.py -q`
Expected: all pass, including the new test and the unchanged click-train, quiet-intro, and chunking tests.

- [ ] **Step 6: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/analysis/identity.py src/setvector/analysis/baseline.py tests/test_analysis_baseline.py
git commit -m "fix(analysis): track beats from the bass band" -m "Full-band spectral flux let off-beat hi-hats capture librosa's beat tracker: on two club tracks only 30% and 44% of beats landed on the beat. A <=150 Hz envelope raised that to 90% and 95%. The stored onset_strength series stays full-band. Algorithm version 3 gives new feature IDs; existing artifacts stay valid."
```

---

### Task 4: Share the atomic publish helper

**Files:**
- Create: `src/setvector/storage/publish.py`
- Modify: `src/setvector/storage/artifacts.py`

This is a pure refactor; `tests/test_storage_artifacts.py` must pass unchanged. Its `os.replace` monkeypatches patch the shared `os` module, so they still reach the moved code.

- [ ] **Step 1: Create `src/setvector/storage/publish.py`**

```python
"""Atomic publication of artifact directories and strict JSON file helpers."""

import json
import os
import shutil
import tempfile
from collections.abc import Callable, Mapping
from pathlib import Path

from setvector.domain import ArtifactError

from .canonical import strict_json_loads


def write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` and flush it to disk."""
    with path.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def write_json(path: Path, value: Mapping[str, object]) -> None:
    """Write indented, key-sorted UTF-8 JSON without NaN or infinity."""
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    write_bytes(path, (text + "\n").encode("utf-8"))


def read_json(path: Path) -> object:
    """Parse JSON strictly: duplicate keys and NaN or infinity are errors."""
    return strict_json_loads(path.read_text(encoding="utf-8"))


def publish_directory(target: Path, write: Callable[[Path], None]) -> bool:
    """Write into a sibling temporary directory and rename it to ``target``.

    Returns ``False`` when another writer published ``target`` first.
    """
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{target.name}.tmp-", dir=target.parent))
    except OSError as error:
        raise ArtifactError(f"cannot create artifact directory {target}: {error}") from error
    try:
        write(temporary)
        os.replace(temporary, target)
    except OSError as error:
        shutil.rmtree(temporary, ignore_errors=True)
        if target.exists():
            return False
        raise ArtifactError(f"cannot publish artifact {target}: {error}") from error
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return True
```

- [ ] **Step 2: Use it from `artifacts.py`**

In `src/setvector/storage/artifacts.py`:
- Delete the functions `_write_bytes`, `_write_json`, `_read_json`, and the method `ArtifactStore._publish`.
- Remove the imports Ruff reports as unused after the move (expected: `json`, `shutil`, `tempfile`, and `strict_json_loads`; keep `os`, which `save` still uses for `os.fsync`).
- Add `from .publish import publish_directory, read_json, write_json`.
- Replace every `_write_json(` with `write_json(`, every `_read_json(` with `read_json(`, and both `self._publish(` calls with `publish_directory(`.

- [ ] **Step 3: Run storage and full tests**

Run: `py -m pytest tests/test_storage_artifacts.py -q; py -m pytest -q; py -m ruff check .; py -m ruff format --check .`
Expected: all pass, with no test file changed.

- [ ] **Step 4: Commit**

```powershell
git add src/setvector/storage/publish.py src/setvector/storage/artifacts.py
git commit -m "refactor(storage): share atomic artifact publication"
```

---

### Task 5: Fit constant-tempo grids

**Files:**
- Modify: `src/setvector/analysis/identity.py` (grid constants)
- Create: `src/setvector/analysis/grid.py`
- Test: `tests/test_analysis_grid.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_analysis_grid.py`:

```python
"""Piecewise-constant tempo grids fitted to detected beats."""

import numpy as np
import pytest

from setvector.analysis import grid


def quantized_beats(bpm=124.0, count=400, start=0.3, fps=50):
    """Beats at ``bpm`` rounded to a detector's frame grid, like Beat This! output."""
    return np.round((start + np.arange(count) * 60.0 / bpm) * fps) / fps


def test_quantized_beats_recover_the_true_tempo():
    beats = quantized_beats()
    # The frame grid makes the median interval read 0.48 s, i.e. 125 BPM.
    assert 60.0 / np.median(np.diff(beats)) == pytest.approx(125.0)
    fit = grid.fit_grid(beats, duration=beats[-1] + 1.0)
    assert len(fit.segments) == 1
    assert fit.segments[0].bpm == pytest.approx(124.0, abs=0.01)
    assert fit.grid_fit == 1.0
    assert fit.beats.size == beats.size
    np.testing.assert_allclose(fit.beats, fit.segments[0].times())


def test_missed_and_extra_beats_do_not_change_tempo():
    rng = np.random.default_rng(1)
    full = quantized_beats()
    interior = np.arange(20, full.size - 20)
    kept = np.delete(full, rng.choice(interior, size=40, replace=False))
    extras = full[rng.choice(interior, size=5, replace=False)] + 0.5 * 60.0 / 124.0
    beats = np.unique(np.concatenate([kept, extras]))
    fit = grid.fit_grid(beats, duration=full[-1] + 1.0)
    assert len(fit.segments) == 1
    assert fit.segments[0].bpm == pytest.approx(124.0, abs=0.01)
    assert fit.beats.size == full.size  # missed beats are filled in, extras are not


def test_tempo_change_splits_into_two_segments_at_the_change():
    slow = 0.5 + np.arange(64) * 0.5
    fast = slow[-1] + 60.0 / 128.0 + np.arange(64) * 60.0 / 128.0
    beats = np.concatenate([slow, fast])
    fit = grid.fit_grid(beats, duration=fast[-1] + 1.0)
    # A boundary beat within tolerance of both lines may join either segment and bias it
    # by about 0.01 BPM.
    assert [s.bpm for s in fit.segments] == pytest.approx([120.0, 128.0], abs=0.05)
    end_of_first = fit.segments[0].times()[-1]
    assert abs(end_of_first - slow[-1]) <= 4 * 0.5
    assert np.all(np.diff(fit.beats) > 0)
    assert fit.grid_fit >= 0.95


def test_short_irregular_sequences_are_never_split():
    rng = np.random.default_rng(2)
    beats = np.sort(rng.uniform(0, 40, size=50))
    fit = grid.fit_grid(beats, duration=41.0)
    assert len(fit.segments) == 1


def test_random_beats_fit_poorly():
    rng = np.random.default_rng(3)
    beats = np.sort(rng.uniform(0, 120, size=200))
    fit = grid.fit_grid(beats, duration=121.0)
    assert fit.grid_fit < 0.90
    assert len(fit.segments) <= grid.MAX_SEGMENTS


def test_grid_stays_inside_the_audio():
    beats = 0.01 + np.arange(40) * 0.5
    fit = grid.fit_grid(beats, duration=beats[-1] + 0.1)
    assert fit.beats[0] >= 0.0
    assert fit.beats[-1] <= beats[-1] + 0.1


def test_fewer_than_two_beats_has_no_grid():
    assert grid.fit_grid(np.array([1.0]), duration=5.0) is None
    assert grid.fit_grid(np.array([]), duration=5.0) is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `py -m pytest tests/test_analysis_grid.py -q`
Expected: FAIL with `ImportError: cannot import name 'grid'`.

- [ ] **Step 3: Add grid constants to `identity.py`**

Append to `src/setvector/analysis/identity.py` (below `DEPENDENCIES`):

```python
# Rhythm grid fitting (see analysis/grid.py).
GRID_TOLERANCE_SECONDS = 0.04
GRID_ACCEPT_FRACTION = 0.90
GRID_MIN_SPLIT_BEATS = 32
GRID_MAX_SEGMENTS = 8
```

- [ ] **Step 4: Implement `src/setvector/analysis/grid.py`**

```python
"""Piecewise-constant tempo grids fitted to detected beat times.

Pure NumPy with no detector knowledge. Each segment has one beat period, so tempo
markers and bar counting stay exact and per-beat detector jitter averages out.
"""

from dataclasses import dataclass

import numpy as np

from .identity import (
    GRID_ACCEPT_FRACTION,
    GRID_MAX_SEGMENTS,
    GRID_MIN_SPLIT_BEATS,
    GRID_TOLERANCE_SECONDS,
)

MAX_SEGMENTS = GRID_MAX_SEGMENTS
_REFITS = 5


@dataclass(frozen=True, slots=True)
class Segment:
    """Grid beats ``start_seconds + n * period`` for ``n`` in ``range(beat_count)``."""

    start_seconds: float
    period: float
    beat_count: int

    @property
    def bpm(self) -> float:
        return 60.0 / self.period

    def times(self) -> np.ndarray:
        return self.start_seconds + np.arange(self.beat_count) * self.period


@dataclass(frozen=True, slots=True)
class GridFit:
    """Fitted segments, their concatenated beats, and the share of detected beats they explain."""

    segments: tuple[Segment, ...]
    beats: np.ndarray
    grid_fit: float


def _initial_indices(times: np.ndarray) -> np.ndarray:
    """Count beat periods from the last beat that sat on the grid.

    A beat far from a whole number of periods (an extra detection between two beats)
    gets an index but does not become the anchor, so it cannot shift later indices.
    """
    period = float(np.median(np.diff(times)))
    indices = np.zeros(times.size, dtype=np.int64)
    anchor_time, anchor_index = float(times[0]), 0
    for i in range(1, times.size):
        steps = (times[i] - anchor_time) / period
        indices[i] = anchor_index + round(steps)
        if abs(steps - round(steps)) <= 0.25:
            anchor_time, anchor_index = float(times[i]), int(indices[i])
    return indices


def _fit_line(times: np.ndarray) -> tuple[float, float, np.ndarray, np.ndarray]:
    """Return ``(period, offset, indices, inliers)`` of one robust constant-tempo line."""
    indices = _initial_indices(times)
    keep = np.ones(times.size, dtype=bool)
    period, offset = float(np.median(np.diff(times))), float(times[0])
    for _ in range(_REFITS):
        if np.unique(indices[keep]).size < 2:
            break
        slope, intercept = np.polyfit(indices[keep], times[keep], 1)
        if slope <= 0:
            break
        period, offset = float(slope), float(intercept)
        indices = np.round((times - offset) / period).astype(np.int64)
        keep = np.abs(times - (offset + period * indices)) <= GRID_TOLERANCE_SECONDS
    keep = np.abs(times - (offset + period * indices)) <= GRID_TOLERANCE_SECONDS
    return period, offset, indices, keep


def _inliers(times: np.ndarray) -> int:
    return int(_fit_line(times)[3].sum())


def _ranges(times: np.ndarray) -> list[tuple[int, int]]:
    """Split beat positions into contiguous ranges that each fit one tempo."""
    pending, accepted = [(0, times.size)], []
    while pending:
        start, stop = pending.pop(0)
        keep = _fit_line(times[start:stop])[3]
        room = len(accepted) + len(pending) + 2 <= GRID_MAX_SEGMENTS
        if (
            keep.mean() >= GRID_ACCEPT_FRACTION
            or stop - start < 2 * GRID_MIN_SPLIT_BEATS
            or not room
        ):
            accepted.append((start, stop))
            continue
        split = max(
            range(start + GRID_MIN_SPLIT_BEATS, stop - GRID_MIN_SPLIT_BEATS + 1),
            key=lambda s: _inliers(times[start:s]) + _inliers(times[s:stop]),
        )
        pending[:0] = [(start, split), (split, stop)]
    return sorted(accepted)


def fit_grid(times, duration: float) -> GridFit | None:
    """Fit segments to sorted beat ``times`` and emit grid beats inside ``[0, duration]``."""
    times = np.asarray(times, dtype=np.float64)
    if times.size < 2:
        return None
    segments: list[Segment] = []
    inliers = 0
    previous_end = -np.inf
    for start, stop in _ranges(times):
        period, offset, indices, keep = _fit_line(times[start:stop])
        inliers += int(keep.sum())
        emitted = offset + period * np.arange(indices.min(), indices.max() + 1)
        emitted = emitted[
            (emitted >= 0.0) & (emitted <= duration) & (emitted > previous_end + period / 2)
        ]
        if emitted.size == 0:
            continue
        segment = Segment(float(emitted[0]), period, int(emitted.size))
        segments.append(segment)
        previous_end = float(segment.times()[-1])
    beats = np.concatenate([s.times() for s in segments]) if segments else np.empty(0)
    return GridFit(tuple(segments), beats, inliers / times.size)
```

- [ ] **Step 5: Run the grid tests**

Run: `py -m pytest tests/test_analysis_grid.py -q`
Expected: 7 passed. If `test_tempo_change_splits_into_two_segments_at_the_change` fails, print `fit.segments` and check `_ranges` before changing any test value.

- [ ] **Step 6: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/analysis/identity.py src/setvector/analysis/grid.py tests/test_analysis_grid.py
git commit -m "feat(analysis): fit constant-tempo beat grids"
```

---

### Task 6: Rhythm domain types and identity

**Files:**
- Modify: `src/setvector/domain/errors.py`, `src/setvector/domain/__init__.py`, `src/setvector/__init__.py`
- Create: `src/setvector/domain/rhythm.py`
- Modify: `src/setvector/storage/canonical.py`, `src/setvector/storage/__init__.py`
- Modify: `tests/conftest.py` (rhythm factory)
- Test: `tests/test_domain_rhythm.py`

- [ ] **Step 1: Add the rhythm factory fixture to `tests/conftest.py`**

Add imports `CandidateQuality, GridSegment, RhythmAnalysis` to the `setvector.domain` import, and `compute_rhythm_id` to the `setvector.storage` import. Append:

```python
@pytest.fixture
def rhythm_factory():
    """Build a valid RhythmAnalysis for a stored FeatureBundle."""

    def build(bundle, source="beat_this", segments=None):
        extractor = ExtractorIdentity(
            name="rhythm-v1",
            algorithm_version=1,
            package_version="0.1.0a1",
            config=bundle.extractor.config,
            parameters={"checkpoint": "final0"},
            dependency_versions={"beat-this": "1.1.0", "torch": "2.14.0"},
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
                    len(beats), 0.01, 1.0, len(segments), 4 if bars else None, 1.0 if bars else None
                )
            },
            reliable=True,
            reasons=(),
        )

    return build
```

(Wrap long lines to satisfy Ruff's 100-character limit.)

- [ ] **Step 2: Write the failing domain tests**

`tests/test_domain_rhythm.py`:

```python
"""Strict validation and round trips of rhythm analyses."""

from dataclasses import replace

import pytest

from setvector.domain import CandidateQuality, GridSegment, RhythmAnalysis
from setvector.storage import compute_rhythm_id


def test_round_trip_and_downbeats(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    assert RhythmAnalysis.from_dict(rhythm.to_dict()) == rhythm
    assert rhythm.downbeats == (rhythm.beats[0], rhythm.beats[4])
    assert rhythm.tempo_bpm == 120.0


def test_grid_segment_times_are_evenly_spaced():
    segment = GridSegment(start_seconds=1.0, bpm=120.0, beat_count=3, first_bar_position=2)
    assert segment.times() == (1.0, 1.5, 2.0)


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"source": "rekordbox"}, "source"),
        ({"reliable": False}, "reliable"),
        ({"tempo_bpm": 121.0}, "tempo_bpm"),
        ({"bar_positions": (1, 2, None, 4, 1, 2, 3, 4)}, "bar_positions"),
        ({"bar_positions": (1, 2, 3)}, "bar_positions"),
        ({"bar_positions": (0, 2, 3, 4, 1, 2, 3, 4)}, "bar_positions"),
        ({"beats": (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.1)}, "grid_segments"),
        ({"detected_beats": (1.0, 0.5)}, "detected_beats"),
        ({"quality": {"other": CandidateQuality(1, None, None, 0, None, None)}}, "quality"),
        ({"reasons": ("",)}, "reasons"),
        ({"asset_id": "A" * 64}, "asset_id"),
    ],
)
def test_invalid_rhythm_is_rejected(report_inputs, rhythm_factory, changes, message):
    _, bundle = report_inputs()
    with pytest.raises(ValueError, match=message):
        replace(rhythm_factory(bundle), **changes)


def test_first_bar_position_must_match_the_segment_start(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    with pytest.raises(ValueError, match="first_bar_position"):
        replace(rhythm, grid_segments=(GridSegment(0.5, 120.0, 8, 2),))


def test_fallback_has_no_bar_positions(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    fallback = rhythm_factory(bundle, source="setvector_fallback")
    assert fallback.downbeats == ()
    with pytest.raises(ValueError, match="setvector_fallback"):
        replace(
            fallback,
            grid_segments=(GridSegment(0.5, 120.0, 8, 1),),
            bar_positions=tuple((i % 4) + 1 for i in range(8)),
        )


def test_none_source_has_no_grid(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    empty = rhythm_factory(bundle, source="none")
    assert RhythmAnalysis.from_dict(empty.to_dict()) == empty
    with pytest.raises(ValueError, match="none"):
        replace(empty, tempo_bpm=120.0)


def test_from_dict_rejects_unknown_and_missing_fields(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    data = rhythm_factory(bundle).to_dict()
    with pytest.raises(ValueError, match="unknown"):
        RhythmAnalysis.from_dict({**data, "extra": 1})
    del data["beats"]
    with pytest.raises(ValueError, match="missing"):
        RhythmAnalysis.from_dict(data)


def test_rhythm_id_depends_on_feature_and_every_extractor_input(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle)
    base = compute_rhythm_id(bundle.feature_id, rhythm.extractor)
    assert base == rhythm.rhythm_id
    assert compute_rhythm_id("b" * 64, rhythm.extractor) != base
    changed = replace(rhythm.extractor, parameters={"checkpoint": "final1"})
    assert compute_rhythm_id(bundle.feature_id, changed) != base
```

- [ ] **Step 3: Run to verify they fail**

Run: `py -m pytest tests/test_domain_rhythm.py -q`
Expected: collection error — `ImportError: cannot import name 'CandidateQuality'`.

- [ ] **Step 4: Add `InstallationError`**

Append to `src/setvector/domain/errors.py`:

```python
class InstallationError(SetVectorError):
    """A required part of the SetVector installation is missing or altered."""
```

- [ ] **Step 5: Implement `src/setvector/domain/rhythm.py`**

```python
"""Validated rhythm analyses: a fitted beat grid, its bars, and how it was chosen."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from ._validation import finite_number, require_fields, validate_version
from .audio import nonempty_string, positive_integer, validate_sha256
from .bundle import ExtractorIdentity

SOURCES = ("beat_this", "setvector_fallback", "none")
CANDIDATES = ("beat_this", "setvector_fallback")

_SEGMENT_FIELDS = {"start_seconds", "bpm", "beat_count", "first_bar_position"}
_QUALITY_FIELDS = {
    "beat_count",
    "interval_cv",
    "grid_fit",
    "segment_count",
    "modal_bar_length",
    "bar_regularity",
}
_RHYTHM_FIELDS = {
    "schema_version",
    "rhythm_id",
    "asset_id",
    "feature_id",
    "extractor",
    "source",
    "grid_segments",
    "beats",
    "bar_positions",
    "detected_beats",
    "tempo_bpm",
    "quality",
    "reliable",
    "reasons",
}


def _array(value: object, field: str) -> tuple[object, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise ValueError(f"{field} must be an array")
    return tuple(value)


def _times(value: object, field: str) -> tuple[float, ...]:
    times = tuple(finite_number(item, field) for item in _array(value, field))
    if any(t < 0 for t in times) or any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError(f"{field} must be nonnegative and strictly increasing")
    return times


def _optional_fraction(value: object, field: str) -> float | None:
    if value is None:
        return None
    number = finite_number(value, field)
    if not 0.0 <= number <= 1.0:
        raise ValueError(f"{field} must be between 0 and 1")
    return number


def _count(value: object, field: str) -> int:
    if type(value) is not int or value < 0:
        raise ValueError(f"{field} must be a nonnegative integer")
    return value


@dataclass(frozen=True, slots=True)
class GridSegment:
    """Constant-tempo grid beats ``start_seconds + n * 60 / bpm``."""

    start_seconds: float
    bpm: float
    beat_count: int
    first_bar_position: int | None

    def __post_init__(self) -> None:
        start = finite_number(self.start_seconds, "start_seconds")
        if start < 0:
            raise ValueError("start_seconds must be nonnegative")
        bpm = finite_number(self.bpm, "bpm")
        if bpm <= 0:
            raise ValueError("bpm must be positive")
        positive_integer(self.beat_count, "beat_count")
        if self.first_bar_position is not None:
            positive_integer(self.first_bar_position, "first_bar_position")
        object.__setattr__(self, "start_seconds", start)
        object.__setattr__(self, "bpm", bpm)

    def times(self) -> tuple[float, ...]:
        """Return this segment's grid beat times."""
        period = 60.0 / self.bpm
        return tuple(self.start_seconds + n * period for n in range(self.beat_count))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "GridSegment":
        """Read one complete grid segment."""
        require_fields(data, _SEGMENT_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return a detached JSON-compatible grid segment."""
        return {
            "start_seconds": self.start_seconds,
            "bpm": self.bpm,
            "beat_count": self.beat_count,
            "first_bar_position": self.first_bar_position,
        }


@dataclass(frozen=True, slots=True)
class CandidateQuality:
    """Measurements used to accept or reject one beat-grid candidate."""

    beat_count: int
    interval_cv: float | None
    grid_fit: float | None
    segment_count: int
    modal_bar_length: int | None
    bar_regularity: float | None

    def __post_init__(self) -> None:
        _count(self.beat_count, "beat_count")
        _count(self.segment_count, "segment_count")
        if self.interval_cv is not None:
            cv = finite_number(self.interval_cv, "interval_cv")
            if cv < 0:
                raise ValueError("interval_cv must be nonnegative")
            object.__setattr__(self, "interval_cv", cv)
        object.__setattr__(self, "grid_fit", _optional_fraction(self.grid_fit, "grid_fit"))
        object.__setattr__(
            self, "bar_regularity", _optional_fraction(self.bar_regularity, "bar_regularity")
        )
        if self.modal_bar_length is not None:
            positive_integer(self.modal_bar_length, "modal_bar_length")
        if (self.modal_bar_length is None) != (self.bar_regularity is None):
            raise ValueError("modal_bar_length and bar_regularity must both be present or absent")

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "CandidateQuality":
        """Read complete candidate measurements."""
        require_fields(data, _QUALITY_FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible candidate measurements."""
        return {
            "beat_count": self.beat_count,
            "interval_cv": self.interval_cv,
            "grid_fit": self.grid_fit,
            "segment_count": self.segment_count,
            "modal_bar_length": self.modal_bar_length,
            "bar_regularity": self.bar_regularity,
        }


@dataclass(frozen=True, slots=True)
class RhythmAnalysis:
    """The beat grid chosen for one baseline feature artifact, with its provenance."""

    rhythm_id: str
    asset_id: str
    feature_id: str
    extractor: ExtractorIdentity
    source: str
    grid_segments: tuple[GridSegment, ...]
    beats: tuple[float, ...]
    bar_positions: tuple[int | None, ...]
    detected_beats: tuple[float, ...]
    tempo_bpm: float | None
    quality: Mapping[str, CandidateQuality]
    reliable: bool
    reasons: tuple[str, ...]
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        for name in ("rhythm_id", "asset_id", "feature_id"):
            object.__setattr__(self, name, validate_sha256(getattr(self, name), name))
        if not isinstance(self.extractor, ExtractorIdentity):
            raise ValueError("extractor must be ExtractorIdentity")
        if self.source not in SOURCES:
            raise ValueError(f"source must be one of {', '.join(SOURCES)}")
        segments = _array(self.grid_segments, "grid_segments")
        if not all(isinstance(segment, GridSegment) for segment in segments):
            raise ValueError("grid_segments must contain GridSegment values")
        beats = _times(self.beats, "beats")
        if beats != tuple(t for segment in segments for t in segment.times()):
            raise ValueError("beats must equal the times generated by grid_segments")
        positions = _array(self.bar_positions, "bar_positions")
        if len(positions) != len(beats):
            raise ValueError("bar_positions must have one entry per beat")
        known = [p is not None for p in positions]
        if any(known) and not all(known):
            raise ValueError("bar_positions must be all known or all null")
        if any(type(p) is not int or p < 1 for p in positions if p is not None):
            raise ValueError("bar_positions must be positive integers")
        start = 0
        for segment in segments:
            if segment.first_bar_position != positions[start]:
                raise ValueError("first_bar_position must equal the segment's first bar position")
            start += segment.beat_count
        detected = _times(self.detected_beats, "detected_beats")
        if not isinstance(self.quality, Mapping):
            raise ValueError("quality must be an object")
        quality = dict(sorted(self.quality.items()))
        if any(name not in CANDIDATES for name in quality) or not all(
            isinstance(value, CandidateQuality) for value in quality.values()
        ):
            raise ValueError(f"quality keys must be among {', '.join(CANDIDATES)}")
        if type(self.reliable) is not bool:
            raise ValueError("reliable must be a boolean")
        reasons = tuple(nonempty_string(r, "reasons") for r in _array(self.reasons, "reasons"))
        if self.reliable != (self.source != "none"):
            raise ValueError("reliable must be true exactly when source is not none")
        if self.source == "none":
            if segments or detected or self.tempo_bpm is not None:
                raise ValueError("source none must have no grid, detected beats, or tempo_bpm")
        else:
            if not segments or self.source not in quality:
                raise ValueError("a selected source needs grid_segments and its quality")
            dominant = max(segments, key=lambda segment: segment.beat_count)
            if self.tempo_bpm != dominant.bpm:
                raise ValueError("tempo_bpm must equal the bpm of the longest segment")
        if self.source == "setvector_fallback" and any(known):
            raise ValueError("setvector_fallback grids have no bar positions")
        object.__setattr__(self, "grid_segments", segments)
        object.__setattr__(self, "beats", beats)
        object.__setattr__(self, "bar_positions", positions)
        object.__setattr__(self, "detected_beats", detected)
        object.__setattr__(self, "quality", MappingProxyType(quality))
        object.__setattr__(self, "reasons", reasons)

    @property
    def downbeats(self) -> tuple[float, ...]:
        """Grid beats at bar position 1."""
        return tuple(t for t, p in zip(self.beats, self.bar_positions) if p == 1)

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "RhythmAnalysis":
        """Read a complete rhythm analysis with strict nested schemas."""
        require_fields(data, _RHYTHM_FIELDS)
        values = dict(data)
        values["extractor"] = ExtractorIdentity.from_dict(values["extractor"])
        values["grid_segments"] = tuple(
            GridSegment.from_dict(item) for item in _array(values["grid_segments"], "grid_segments")
        )
        if not isinstance(values["quality"], Mapping):
            raise ValueError("quality must be an object")
        values["quality"] = {
            name: CandidateQuality.from_dict(item) for name, item in values["quality"].items()
        }
        for name in ("beats", "bar_positions", "detected_beats", "reasons"):
            values[name] = _array(values[name], name)
        return cls(**values)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible rhythm analysis."""
        return {
            "schema_version": self.schema_version,
            "rhythm_id": self.rhythm_id,
            "asset_id": self.asset_id,
            "feature_id": self.feature_id,
            "extractor": self.extractor.to_dict(),
            "source": self.source,
            "grid_segments": [segment.to_dict() for segment in self.grid_segments],
            "beats": list(self.beats),
            "bar_positions": list(self.bar_positions),
            "detected_beats": list(self.detected_beats),
            "tempo_bpm": self.tempo_bpm,
            "quality": {name: value.to_dict() for name, value in self.quality.items()},
            "reliable": self.reliable,
            "reasons": list(self.reasons),
        }
```

- [ ] **Step 6: Export the new names**

In `src/setvector/domain/__init__.py`, add `InstallationError` to the `.errors` import, add `from .rhythm import CandidateQuality, GridSegment, RhythmAnalysis`, and add `"CandidateQuality"`, `"GridSegment"`, `"InstallationError"`, `"RhythmAnalysis"` to `__all__` (sorted). Add the same four names to the import and `__all__` in `src/setvector/__init__.py`.

- [ ] **Step 7: Add `compute_rhythm_id`**

Append to `src/setvector/storage/canonical.py`:

```python
def compute_rhythm_id(feature_id: str, extractor: ExtractorIdentity) -> str:
    """SHA-256 of the baseline feature identity and every rhythm extractor input."""
    payload = {"feature_id": feature_id, "extractor": extractor.to_dict()}
    return hashlib.sha256(canonical_json(payload)).hexdigest()
```

Export it from `src/setvector/storage/__init__.py` (import and `__all__`).

- [ ] **Step 8: Run the domain tests**

Run: `py -m pytest tests/test_domain_rhythm.py -q`
Expected: all pass. If the `beats` case in `test_invalid_rhythm_is_rejected` fails with the wrong message, check the order of checks in `__post_init__` against the test's `match`.

- [ ] **Step 9: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/domain src/setvector/__init__.py src/setvector/storage/canonical.py src/setvector/storage/__init__.py tests/conftest.py tests/test_domain_rhythm.py
git commit -m "feat(domain): define rhythm analyses and their identity"
```

---

### Task 7: Rhythm artifact store

**Files:**
- Create: `src/setvector/storage/rhythm.py`
- Modify: `src/setvector/storage/__init__.py`
- Test: `tests/test_storage_rhythm.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_storage_rhythm.py`:

```python
"""Atomic, verified rhythm artifacts."""

import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

import setvector.storage.publish as publish_module
from setvector.domain import ArtifactError
from setvector.storage import RhythmStore


@pytest.fixture
def rhythm(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    return rhythm_factory(bundle)


def test_save_then_load_round_trips(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    assert path == tmp_path.resolve() / "rhythm" / rhythm.rhythm_id / "rhythm.json"
    assert store.path(rhythm.rhythm_id) == path
    assert store.load(rhythm.rhythm_id) == rhythm


def test_missing_rhythm_loads_as_none(tmp_path, rhythm):
    assert RhythmStore(tmp_path).load(rhythm.rhythm_id) is None


def test_saving_identical_rhythm_twice_is_accepted(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    assert store.save(rhythm) == store.save(rhythm)


def test_conflicting_existing_rhythm_is_an_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    data = json.loads(path.read_text(encoding="utf-8"))
    data["reasons"] = ["tampered"]
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ArtifactError, match="differs"):
        store.save(rhythm)


def test_corrupt_rhythm_is_an_artifact_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    store.save(rhythm).write_text("{not json", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        store.load(rhythm.rhythm_id)


def test_rhythm_in_the_wrong_directory_is_an_artifact_error(tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    path = store.save(rhythm)
    moved = path.parent.parent / ("c" * 64)
    path.parent.rename(moved)
    with pytest.raises(ArtifactError, match="directory"):
        store.load("c" * 64)


def test_save_rejects_a_rhythm_whose_id_does_not_match(tmp_path, rhythm):
    with pytest.raises(ArtifactError, match="rhythm_id"):
        RhythmStore(tmp_path).save(replace(rhythm, rhythm_id="d" * 64))


def test_failed_rename_leaves_nothing_published(monkeypatch, tmp_path, rhythm):
    store = RhythmStore(tmp_path)
    real_replace = os.replace

    def failing_replace(source, target):
        if Path(target).parent.name == "rhythm":
            raise OSError("simulated rename failure")
        return real_replace(source, target)

    monkeypatch.setattr(publish_module.os, "replace", failing_replace)
    with pytest.raises(ArtifactError, match="publish"):
        store.save(rhythm)
    assert list((tmp_path / "rhythm").iterdir()) == []
    assert store.load(rhythm.rhythm_id) is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `py -m pytest tests/test_storage_rhythm.py -q`
Expected: collection error — `ImportError: cannot import name 'RhythmStore'`.

- [ ] **Step 3: Implement `src/setvector/storage/rhythm.py`**

```python
"""Atomic, validated rhythm artifacts in a local workspace.

Layout::

    <workspace>/rhythm/<rhythm-id>/rhythm.json
"""

from pathlib import Path

from setvector.domain import ArtifactError, RhythmAnalysis
from setvector.domain.audio import validate_sha256

from .canonical import compute_rhythm_id
from .publish import publish_directory, read_json, write_json

_RHYTHM = "rhythm.json"


class RhythmStore:
    """Save and load content-addressed rhythm artifacts under one workspace."""

    def __init__(self, workspace: str | Path) -> None:
        self.workspace = Path(workspace).resolve()

    def path(self, rhythm_id: str) -> Path:
        """Return the absolute ``rhythm.json`` location for ``rhythm_id``."""
        return self._directory(rhythm_id) / _RHYTHM

    def load(self, rhythm_id: str) -> RhythmAnalysis | None:
        """Return a valid stored analysis, ``None`` when absent, or raise ``ArtifactError``."""
        directory = self._directory(rhythm_id)
        if not directory.exists():
            return None
        return _read(directory, rhythm_id)

    def save(self, analysis: RhythmAnalysis) -> Path:
        """Publish ``analysis`` atomically, or accept an identical existing artifact."""
        if compute_rhythm_id(analysis.feature_id, analysis.extractor) != analysis.rhythm_id:
            raise ArtifactError("rhythm_id does not match its feature and extractor identity")
        target = self._directory(analysis.rhythm_id)
        if target.exists():
            return self._accept_existing(analysis)

        def write(directory: Path) -> None:
            write_json(directory / _RHYTHM, analysis.to_dict())
            if _read(directory, analysis.rhythm_id) != analysis:
                raise ArtifactError(f"rhythm artifact {analysis.rhythm_id} failed verification")

        if not publish_directory(target, write):
            return self._accept_existing(analysis)
        return target / _RHYTHM

    def _directory(self, rhythm_id: str) -> Path:
        return self.workspace / "rhythm" / validate_sha256(rhythm_id, "rhythm_id")

    def _accept_existing(self, analysis: RhythmAnalysis) -> Path:
        if self.load(analysis.rhythm_id) != analysis:
            raise ArtifactError(
                f"existing rhythm artifact {analysis.rhythm_id} differs from the new results"
            )
        return self.path(analysis.rhythm_id)


def _read(directory: Path, rhythm_id: str) -> RhythmAnalysis:
    path = directory / _RHYTHM
    if not path.is_file():
        raise ArtifactError(f"rhythm artifact {rhythm_id} is incomplete: {directory}")
    try:
        analysis = RhythmAnalysis.from_dict(read_json(path))
        if analysis.rhythm_id != rhythm_id:
            raise ValueError("rhythm_id does not match its directory")
        if compute_rhythm_id(analysis.feature_id, analysis.extractor) != rhythm_id:
            raise ValueError("rhythm_id does not match the recorded feature and extractor")
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise ArtifactError(
            f"rhythm artifact {rhythm_id} is corrupt or incompatible: {error}"
        ) from error
    return analysis
```

Export `RhythmStore` from `src/setvector/storage/__init__.py`.

- [ ] **Step 4: Run the store tests**

Run: `py -m pytest tests/test_storage_rhythm.py -q`
Expected: 8 passed. (The "wrong directory" case raises `rhythm_id does not match its directory` inside the "corrupt or incompatible" message; its `match="directory"` finds it.)

- [ ] **Step 5: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/storage/rhythm.py src/setvector/storage/__init__.py tests/test_storage_rhythm.py
git commit -m "feat(storage): store rhythm artifacts atomically"
```

---

### Task 8: Beat This! detector wrapper

**Files:**
- Create: `src/setvector/analysis/beat_this.py`
- Modify: `tests/conftest.py` (marker and autouse stub)
- Test: `tests/test_analysis_beat_this.py`

Measured before writing this plan: on the drum pattern below, the real model matched all 64 true beats within 40 ms and 16 of its 17 downbeats were within 40 ms of a true downbeat, in 2 s on CPU.

- [ ] **Step 1: Write the failing tests**

`tests/test_analysis_beat_this.py`:

```python
"""Beat This! runs only from the verified bundled checkpoint."""

import numpy as np
import pytest

from setvector.analysis import beat_this
from setvector.domain import InstallationError
from setvector.models import checkpoint


def drum_pattern(sample_rate=22_050, bpm=120.0, bars=16, start=0.5):
    """Kick on every beat, snare on 2 and 4, off-beat hats, a bass note and crash on bar 1."""
    period = 60.0 / bpm
    size = int(sample_rate * (start + bars * 4 * period + 1))
    signal = np.zeros(size)
    rng = np.random.default_rng(3)

    def put(sound, at, gain):
        i = int(at * sample_rate)
        signal[i : i + sound.size] += gain * sound[: size - i]

    def decay(seconds, tau):
        return np.exp(-np.arange(int(seconds * sample_rate)) / sample_rate / tau)

    t = np.arange(int(0.2 * sample_rate)) / sample_rate
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    snare = rng.standard_normal(int(0.15 * sample_rate)) * decay(0.15, 0.04)
    hat = rng.standard_normal(int(0.04 * sample_rate)) * decay(0.04, 0.01)
    crash = rng.standard_normal(sample_rate) * decay(1.0, 0.3)
    beats = start + np.arange(bars * 4) * period
    for i, beat in enumerate(beats):
        put(kick, beat, 0.9)
        if i % 4 in (1, 3):
            put(snare, beat, 0.5)
        put(hat, beat + period / 2, 0.2)
    bar_t = np.arange(int(4 * period * sample_rate)) / sample_rate
    for j, downbeat in enumerate(beats[::4]):
        root = (55.0, 43.65, 49.0, 41.2)[j % 4]
        put(np.sin(2 * np.pi * root * bar_t) * np.minimum(1, bar_t / 0.01), downbeat, 0.3)
        if j % 4 == 0:
            put(crash, downbeat, 0.3)
    signal = 0.9 * signal / np.abs(signal).max()
    return signal.astype(np.float32), beats, beats[::4]


def nearest(values, reference):
    return np.min(np.abs(np.asarray(values)[:, None] - np.asarray(reference)[None, :]), axis=1)


def test_refinement_moves_a_peak_between_frames():
    frames = np.arange(100, dtype=float)
    parabola = -((frames - 40.3) ** 2)
    assert beat_this.refine_peak_times([40 / 50], parabola)[0] == pytest.approx(40.3 / 50)
    bump = np.exp(-(((frames - 60.25) / 1.5) ** 2))
    assert beat_this.refine_peak_times([60 / 50], bump)[0] == pytest.approx(60.25 / 50, abs=0.002)


def test_refinement_leaves_edges_and_flat_peaks_alone():
    activation = np.zeros(10)
    activation[5] = activation[6] = 1.0
    times = [0.0, 5 / 50, 9 / 50]
    np.testing.assert_array_equal(beat_this.refine_peak_times(times, activation), times)


@pytest.mark.real_model
def test_missing_checkpoint_is_an_installation_error(monkeypatch, tmp_path):
    monkeypatch.setattr(checkpoint, "PATH", tmp_path / "missing.ckpt")
    with pytest.raises(InstallationError, match="fetch_model"):
        beat_this.detect(np.zeros(22_050, np.float32), 22_050)


def test_altered_checkpoint_is_an_installation_error(monkeypatch, tmp_path):
    altered = tmp_path / "altered.ckpt"
    altered.write_bytes(b"not the model")
    monkeypatch.setattr(checkpoint, "PATH", altered)
    with pytest.raises(InstallationError, match="SHA-256"):
        beat_this.verify_checkpoint()


@pytest.mark.real_model
def test_bundled_model_finds_beats_and_downbeats_of_a_drum_pattern():
    samples, beats, downbeats = drum_pattern()
    detection = beat_this.detect(samples, 22_050)
    assert np.mean(nearest(beats, detection.beats) <= 0.04) >= 0.95
    assert abs(len(detection.downbeats) - len(downbeats)) <= 2
    assert np.mean(nearest(detection.downbeats, downbeats) <= 0.04) >= 0.8


def test_other_tests_get_the_stub(monkeypatch):
    detection = beat_this.detect(np.zeros(10, np.float32), 22_050)
    assert detection.beats.size == 0 and detection.downbeats.size == 0
```

- [ ] **Step 2: Register the marker and the stub in `tests/conftest.py`**

Append:

```python
def pytest_configure(config):
    config.addinivalue_line(
        "markers", "real_model: run the bundled Beat This! model instead of the test stub"
    )


@pytest.fixture(autouse=True)
def stub_beat_this(request, monkeypatch):
    """Keep tests fast: Beat This! finds nothing unless a test is marked real_model."""
    if request.node.get_closest_marker("real_model"):
        return
    from setvector.analysis import beat_this

    def detect(samples, sample_rate):
        return beat_this.Detection(beats=np.empty(0), downbeats=np.empty(0))

    monkeypatch.setattr(beat_this, "detect", detect)
```

Subprocess tests (`test_cli.py`, `test_offline_analysis.py`) are not affected by this stub and run the real model.

- [ ] **Step 3: Run to verify they fail**

Run: `py -m pytest tests/test_analysis_beat_this.py -q`
Expected: errors — `ImportError: cannot import name 'beat_this'` (the autouse fixture fails the same way for every test until Step 4).

- [ ] **Step 4: Implement `src/setvector/analysis/beat_this.py`**

```python
"""Beat This! beat and downbeat detection from the bundled checkpoint.

This is the only module that imports PyTorch or Beat This!, and it does so lazily.
The checkpoint loads only from the package after its SHA-256 matches, so Beat This!'s
download fallback (used when a checkpoint path does not exist) is never reached.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from setvector.domain import AnalysisError, InstallationError
from setvector.models import checkpoint

FPS = 50


@dataclass(frozen=True, slots=True)
class Detection:
    """Beat and downbeat times in seconds from one detector run."""

    beats: np.ndarray
    downbeats: np.ndarray


def verify_checkpoint(path: Path | None = None) -> Path:
    """Return the bundled checkpoint path after checking it exists and matches its hash."""
    path = checkpoint.PATH if path is None else path
    if not path.is_file():
        raise InstallationError(
            f"the Beat This! checkpoint is missing: {path}. Reinstall SetVector, or in a "
            "source checkout run: python scripts/fetch_model.py"
        )
    actual = checkpoint.sha256_file(path)
    if actual != checkpoint.SHA256:
        raise InstallationError(
            f"the Beat This! checkpoint at {path} has SHA-256 {actual}, expected "
            f"{checkpoint.SHA256}. Reinstall SetVector, or rerun scripts/fetch_model.py"
        )
    return path


@lru_cache(maxsize=1)
def _frames_model(path: str):
    from beat_this.inference import Audio2Frames

    return Audio2Frames(checkpoint_path=path, device="cpu")


def refine_peak_times(times, activation, fps: int = FPS) -> np.ndarray:
    """Move each peak-frame time to the vertex of a parabola through its neighbours.

    Times whose frame is at an edge or is not a strict local maximum are unchanged.
    """
    activation = np.asarray(activation, dtype=np.float64)
    refined = np.array(times, dtype=np.float64)
    for i, time in enumerate(refined):
        frame = int(round(time * fps))
        if not 0 < frame < activation.size - 1:
            continue
        left, peak, right = activation[frame - 1 : frame + 2]
        if peak <= left or peak <= right:
            continue
        offset = 0.5 * (left - right) / (left - 2 * peak + right)
        refined[i] = (frame + float(np.clip(offset, -0.5, 0.5))) / fps
    return refined


def detect(samples: np.ndarray, sample_rate: int) -> Detection:
    """Run Beat This! on mono samples; return refined beats and its downbeats."""
    path = verify_checkpoint()
    try:
        from beat_this.model.postprocessor import Postprocessor
    except ImportError as error:
        raise InstallationError(f"Beat This! is not installed correctly: {error}") from error
    try:
        model = _frames_model(str(path))
        beat_logits, downbeat_logits = model(np.asarray(samples, dtype=np.float32), sample_rate)
        beats, downbeats = Postprocessor(type="minimal", fps=FPS)(beat_logits, downbeat_logits)
        activation = beat_logits.detach().cpu().numpy()
    except Exception as error:
        raise AnalysisError(f"Beat This! detection failed: {error}") from error
    return Detection(
        beats=refine_peak_times(beats, activation),
        downbeats=np.asarray(downbeats, dtype=np.float64),
    )
```

- [ ] **Step 5: Run the wrapper tests**

Run: `py -m pytest tests/test_analysis_beat_this.py -q`
Expected: 6 passed (the real-model test takes a few seconds). If the drum-pattern test fails, report the printed numbers; do not loosen the thresholds.

- [ ] **Step 6: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/analysis/beat_this.py tests/conftest.py tests/test_analysis_beat_this.py
git commit -m "feat(analysis): detect beats with the bundled Beat This! model"
```

---

### Task 9: Choose the rhythm source

**Files:**
- Modify: `src/setvector/analysis/identity.py` (rhythm constants, `rhythm_identity`)
- Create: `src/setvector/analysis/rhythm.py`
- Modify: `src/setvector/analysis/__init__.py`
- Test: `tests/test_analysis_rhythm.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_analysis_rhythm.py`:

```python
"""Beat This! first, the baseline tracker second, and no grid when neither is reliable."""

from dataclasses import replace
from importlib.metadata import version

import numpy as np
import pytest

from setvector.analysis import baseline_identity, extract_rhythm, rhythm_identity
from setvector.analysis.beat_this import Detection
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


def test_irregular_beat_this_falls_back_to_regular_baseline_beats(context):
    rng = np.random.default_rng(0)
    erratic = np.sort(rng.uniform(0, 59, 60))
    rhythm = run(context(baseline_beats=range(0, 118)), Detection(erratic, erratic[::3]))
    assert rhythm.source == "setvector_fallback" and rhythm.reliable
    assert rhythm.downbeats == () and set(rhythm.bar_positions) == {None}
    assert rhythm.tempo_bpm == pytest.approx(120.0, abs=0.01)
    assert any(reason.startswith("beat_this:") for reason in rhythm.reasons)
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
    assert identity.parameters["checkpoint_sha256"] == (
        "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
    )
    assert identity.parameters["min_grid_fit"] == 0.9
    assert identity.dependency_versions["torch"] == version("torch")
    assert set(identity.dependency_versions) == {"beat-this", "numpy", "soxr", "torch"}
```

(Reformat with `py -m ruff format tests/test_analysis_rhythm.py` after pasting.)

- [ ] **Step 2: Run to verify they fail**

Run: `py -m pytest tests/test_analysis_rhythm.py -q`
Expected: collection error — `ImportError: cannot import name 'extract_rhythm'`.

- [ ] **Step 3: Add rhythm constants and `rhythm_identity` to `identity.py`**

Add `from setvector.models import checkpoint` and `from setvector.domain import AnalysisConfig, ExtractorIdentity` (extend the existing import). Append:

```python
# Rhythm candidate acceptance (see analysis/rhythm.py). Provisional until measured
# against reviewed Rekordbox grids.
RHYTHM_EXTRACTOR_NAME = "rhythm-v1"
RHYTHM_ALGORITHM_VERSION = 1
MIN_BEATS = 32
MAX_INTERVAL_CV = 0.15
MIN_GRID_FIT = 0.90
MIN_BAR_REGULARITY = 0.75
BAR_LENGTHS = (3, 4)
MIN_DETECTION_SECONDS = 1.0
RHYTHM_PARAMETERS = {
    "checkpoint": checkpoint.NAME,
    "checkpoint_sha256": checkpoint.SHA256,
    "postprocessor": "minimal",
    "peak_refinement": "parabolic",
    "grid_tolerance_seconds": GRID_TOLERANCE_SECONDS,
    "grid_accept_fraction": GRID_ACCEPT_FRACTION,
    "grid_min_split_beats": GRID_MIN_SPLIT_BEATS,
    "grid_max_segments": GRID_MAX_SEGMENTS,
    "min_beats": MIN_BEATS,
    "max_interval_cv": MAX_INTERVAL_CV,
    "min_grid_fit": MIN_GRID_FIT,
    "min_bar_regularity": MIN_BAR_REGULARITY,
    "bar_lengths": ",".join(map(str, BAR_LENGTHS)),
    "min_detection_seconds": MIN_DETECTION_SECONDS,
}
RHYTHM_DEPENDENCIES = ("beat-this", "numpy", "soxr", "torch")


def rhythm_identity(baseline: ExtractorIdentity) -> ExtractorIdentity:
    """Describe every input that can change the rhythm derived from ``baseline`` features."""
    return ExtractorIdentity(
        name=RHYTHM_EXTRACTOR_NAME,
        algorithm_version=RHYTHM_ALGORITHM_VERSION,
        package_version=version("setvector"),
        config=baseline.config,
        parameters=RHYTHM_PARAMETERS,
        dependency_versions={name: version(name) for name in RHYTHM_DEPENDENCIES},
    )
```

(The grid constants from Task 5 must stay above this block.)

- [ ] **Step 4: Implement `src/setvector/analysis/rhythm.py`**

```python
"""Choose one track's beat grid: Beat This! first, the baseline tracker second.

Each candidate's beats are fitted to a constant-tempo grid and scored. The first
reliable candidate wins; when neither is reliable the analysis has no grid, and its
reasons say why.
"""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from setvector.domain import (
    CandidateQuality,
    ExtractorIdentity,
    FeatureBundle,
    GridSegment,
    RhythmAnalysis,
)
from setvector.ingestion import DecodedAudio

from . import beat_this, grid
from .identity import (
    BAR_LENGTHS,
    MAX_INTERVAL_CV,
    MIN_BAR_REGULARITY,
    MIN_BEATS,
    MIN_DETECTION_SECONDS,
    MIN_GRID_FIT,
)

Runner = Callable[[np.ndarray, int], beat_this.Detection]


@dataclass(frozen=True, slots=True)
class _Candidate:
    name: str
    detected: np.ndarray
    fit: grid.GridFit | None
    quality: CandidateQuality
    bar_positions: tuple[int | None, ...]
    reasons: tuple[str, ...]


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def _interval_cv(beats: np.ndarray) -> float | None:
    intervals = np.diff(beats)
    if intervals.size < 2 or intervals.mean() <= 0:
        return None
    return float(intervals.std() / intervals.mean())


def _nearest(times: np.ndarray, targets: np.ndarray) -> np.ndarray:
    return np.argmin(np.abs(times[None, :] - targets[:, None]), axis=1)


def _bar_stats(beats: np.ndarray, downbeats: np.ndarray) -> tuple[int | None, float | None]:
    if beats.size == 0 or downbeats.size < 2:
        return None, None
    lengths = np.diff(np.unique(_nearest(beats, downbeats)))
    if lengths.size == 0:
        return None, None
    modal = int(np.bincount(lengths).argmax())
    return modal, float(np.mean(lengths == modal))


def _bar_positions(grid_beats: np.ndarray, downbeats: np.ndarray, modal: int) -> tuple[int, ...]:
    """Number grid beats within bars; missed downbeats keep counting in ``modal`` bars."""
    marked = set(_nearest(grid_beats, downbeats).tolist())
    first = min(marked)
    positions = [(modal - (first - i) % modal) % modal + 1 for i in range(first)]
    count = 0
    for i in range(first, grid_beats.size):
        count = 1 if i in marked or count >= modal else count + 1
        positions.append(count)
    return tuple(positions)


def _evaluate(name, detected, downbeats, duration) -> _Candidate:
    detected = np.asarray(detected, dtype=np.float64)
    fit = grid.fit_grid(detected, duration)
    modal, regularity = (None, None) if downbeats is None else _bar_stats(detected, downbeats)
    quality = CandidateQuality(
        beat_count=int(detected.size),
        interval_cv=_interval_cv(detected),
        grid_fit=None if fit is None else fit.grid_fit,
        segment_count=0 if fit is None else len(fit.segments),
        modal_bar_length=modal,
        bar_regularity=regularity,
    )
    reasons = []
    if detected.size < MIN_BEATS:
        reasons.append(f"{name}: {detected.size} beats, fewer than {MIN_BEATS}")
    if quality.interval_cv is None or quality.interval_cv > MAX_INTERVAL_CV:
        reasons.append(f"{name}: beat intervals vary too much (CV {_fmt(quality.interval_cv)})")
    if quality.grid_fit is None or quality.grid_fit < MIN_GRID_FIT:
        reasons.append(f"{name}: only {_fmt(quality.grid_fit)} of beats fit a steady grid")
    if downbeats is not None:
        if modal not in BAR_LENGTHS:
            reasons.append(f"{name}: usual bar length is {modal} beats, not 3 or 4")
        elif regularity < MIN_BAR_REGULARITY:
            reasons.append(f"{name}: only {regularity:.2f} of bars have {modal} beats")
    positions: tuple[int | None, ...] = ()
    if fit is not None:
        if not reasons and downbeats is not None:
            positions = _bar_positions(fit.beats, np.asarray(downbeats, dtype=np.float64), modal)
        else:
            positions = (None,) * fit.beats.size
    return _Candidate(name, detected, fit, quality, positions, tuple(reasons))


def extract_rhythm(
    decoded: DecodedAudio,
    bundle: FeatureBundle,
    extractor: ExtractorIdentity,
    rhythm_id: str,
    runner: Runner | None = None,
) -> RhythmAnalysis:
    """Detect, fit, score, and select the beat grid for ``bundle``'s decoded audio."""
    duration = decoded.samples.shape[1] / decoded.sample_rate
    if duration >= MIN_DETECTION_SECONDS:
        run = beat_this.detect if runner is None else runner
        detection = run(decoded.samples.mean(axis=0), decoded.sample_rate)
        beats, downbeats = detection.beats, detection.downbeats
    else:
        beats, downbeats = np.empty(0), np.empty(0)
    candidates = [_evaluate("beat_this", beats, downbeats, duration)]
    if candidates[0].reasons:
        baseline = [beat.seconds for beat in bundle.measurements.beats]
        candidates.append(_evaluate("setvector_fallback", baseline, None, duration))
    chosen = next((c for c in candidates if not c.reasons), None)
    common = dict(
        rhythm_id=rhythm_id,
        asset_id=bundle.asset_id,
        feature_id=bundle.feature_id,
        extractor=extractor,
        quality={c.name: c.quality for c in candidates},
        reasons=tuple(reason for c in candidates for reason in c.reasons),
    )
    if chosen is None:
        return RhythmAnalysis(
            source="none",
            grid_segments=(),
            beats=(),
            bar_positions=(),
            detected_beats=(),
            tempo_bpm=None,
            reliable=False,
            **common,
        )
    segments, start = [], 0
    for segment in chosen.fit.segments:
        segments.append(
            GridSegment(
                start_seconds=segment.start_seconds,
                bpm=segment.bpm,
                beat_count=segment.beat_count,
                first_bar_position=chosen.bar_positions[start],
            )
        )
        start += segment.beat_count
    return RhythmAnalysis(
        source=chosen.name,
        grid_segments=tuple(segments),
        beats=tuple(t for segment in segments for t in segment.times()),
        bar_positions=chosen.bar_positions,
        detected_beats=tuple(float(t) for t in chosen.detected),
        tempo_bpm=max(segments, key=lambda segment: segment.beat_count).bpm,
        reliable=True,
        **common,
    )
```

- [ ] **Step 5: Export from `src/setvector/analysis/__init__.py`**

```python
"""Numerical feature extraction without filesystem access."""

from .baseline import extract_baseline
from .identity import baseline_identity, rhythm_identity
from .rhythm import extract_rhythm

__all__ = ["baseline_identity", "extract_baseline", "extract_rhythm", "rhythm_identity"]
```

- [ ] **Step 6: Run the rhythm tests**

Run: `py -m pytest tests/test_analysis_rhythm.py -q`
Expected: 7 passed. `detected_beats` must stay strictly increasing: if a test fails in `RhythmAnalysis` validation with `detected_beats`, sort and de-duplicate in `_evaluate` (`np.unique`) rather than changing the domain rule.

- [ ] **Step 7: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/analysis tests/test_analysis_rhythm.py
git commit -m "feat(analysis): choose a reliable beat grid for each track"
```

---

### Task 10: Run the rhythm stage from `analyze`

**Files:**
- Modify: `src/setvector/application/analyze.py`
- Modify: `src/setvector/cli/__init__.py`
- Test: `tests/test_application_analyze.py`, `tests/test_cli.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_application_analyze.py`, add `import shutil` to the standard-library imports and change the storage import to `from setvector.storage import ArtifactStore, RhythmStore`. Then append:

```python
def counting(function, calls):
    def wrapper(*args, **kwargs):
        calls.append(function.__name__)
        return function(*args, **kwargs)

    return wrapper


def test_analyze_writes_then_reuses_rhythm(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    first = analyze_track(tone_path, config, store)
    second = analyze_track(tone_path, config, store)
    assert not first.rhythm_cache_hit and second.rhythm_cache_hit
    assert second.rhythm == first.rhythm
    assert first.rhythm.feature_id == first.features.feature_id
    assert first.rhythm_path == RhythmStore(store.workspace).path(first.rhythm.rhythm_id)
    assert first.rhythm_path.is_file()
    # The stubbed detector finds nothing and a 3 s tone has too few baseline beats.
    assert first.rhythm.source == "none"


def test_missing_rhythm_is_recomputed_without_rerunning_baseline(
    monkeypatch, tmp_path, tone_path, config
):
    store = ArtifactStore(tmp_path / "workspace")
    first = analyze_track(tone_path, config, store)
    shutil.rmtree(first.rhythm_path.parent)
    monkeypatch.setattr("setvector.application.analyze.extract_baseline", unexpected_call)
    second = analyze_track(tone_path, config, store)
    assert second.cache_hit and not second.rhythm_cache_hit
    assert second.rhythm == first.rhythm


def test_both_stages_missing_decode_once(monkeypatch, tmp_path, tone_path, config):
    import setvector.application.analyze as analyze_module

    calls = []
    monkeypatch.setattr(
        analyze_module, "decode_audio", counting(analyze_module.decode_audio, calls)
    )
    analyze_track(tone_path, config, ArtifactStore(tmp_path / "workspace"))
    assert calls == ["decode_audio"]
```

In `test_cache_hit_does_not_decode_or_extract`, also add:
```python
    monkeypatch.setattr("setvector.application.analyze.extract_rhythm", unexpected_call)
```

In `tests/test_cli.py`, change the key assertion in `test_analyze_cli_emits_machine_json_and_reuses_cache` to:

```python
    assert set(output) == {
        "asset_id",
        "feature_id",
        "cache_hit",
        "manifest_path",
        "rhythm_id",
        "rhythm_source",
        "rhythm_reliable",
        "downbeat_count",
    }
    assert output["rhythm_source"] in ("beat_this", "setvector_fallback", "none")
    assert isinstance(output["rhythm_reliable"], bool)
```

This CLI test runs in a subprocess, so the real model analyzes the 3-second click tone.

- [ ] **Step 2: Run to verify they fail**

Run: `py -m pytest tests/test_application_analyze.py tests/test_cli.py -q`
Expected: failures on `rhythm_cache_hit` / missing `extract_rhythm` attribute and on the CLI key set.

- [ ] **Step 3: Implement the stage in `src/setvector/application/analyze.py`**

```python
"""Analyze one local track, reusing stored feature and rhythm artifacts when possible."""

from dataclasses import dataclass
from pathlib import Path

from setvector.analysis import baseline_identity, extract_baseline, extract_rhythm, rhythm_identity
from setvector.domain import AnalysisConfig, AudioAsset, FeatureBundle, RhythmAnalysis
from setvector.ingestion import decode_audio, inspect_audio
from setvector.storage import ArtifactStore, RhythmStore, compute_feature_id, compute_rhythm_id


@dataclass(frozen=True, slots=True)
class AnalysisOutcome:
    """The analyzed asset, its features and rhythm, where they are stored, and cache reuse."""

    asset: AudioAsset
    features: FeatureBundle
    manifest_path: Path
    cache_hit: bool
    rhythm: RhythmAnalysis
    rhythm_path: Path
    rhythm_cache_hit: bool


def analyze_track(
    path: str | Path, config: AnalysisConfig, store: ArtifactStore
) -> AnalysisOutcome:
    """Inspect, then load cached artifacts or decode once and compute the missing ones.

    Both identities are computed from content and environment before decoding, so
    intact cached artifacts are returned without decoding the audio again.
    """
    asset = inspect_audio(path)
    extractor = baseline_identity(config)
    feature_id = compute_feature_id(asset.asset_id, extractor)
    features = store.load(feature_id, asset)
    rhythm_extractor = rhythm_identity(extractor)
    rhythm_id = compute_rhythm_id(feature_id, rhythm_extractor)
    rhythm_store = RhythmStore(store.workspace)
    rhythm = rhythm_store.load(rhythm_id)
    feature_hit, rhythm_hit = features is not None, rhythm is not None
    decoded = None if feature_hit and rhythm_hit else decode_audio(path, asset, config)
    if features is None:
        features = FeatureBundle(
            feature_id=feature_id,
            asset_id=asset.asset_id,
            config_id=config.config_id,
            extractor=extractor,
            measurements=extract_baseline(decoded, config),
        )
        manifest_path = store.save(asset, features)
    else:
        manifest_path = store.manifest_path(feature_id)
    if rhythm is None:
        rhythm = extract_rhythm(decoded, features, rhythm_extractor, rhythm_id)
        rhythm_path = rhythm_store.save(rhythm)
    else:
        rhythm_path = rhythm_store.path(rhythm_id)
    return AnalysisOutcome(
        asset, features, manifest_path, feature_hit, rhythm, rhythm_path, rhythm_hit
    )
```

- [ ] **Step 4: Report rhythm in the CLI**

In `_run_analyze` in `src/setvector/cli/__init__.py`, replace the `result` dict and warnings loop with:

```python
    rhythm = outcome.rhythm
    result = {
        "asset_id": outcome.asset.asset_id,
        "feature_id": outcome.features.feature_id,
        "cache_hit": outcome.cache_hit,
        "manifest_path": str(outcome.manifest_path),
        "rhythm_id": rhythm.rhythm_id,
        "rhythm_source": rhythm.source,
        "rhythm_reliable": rhythm.reliable,
        "downbeat_count": len(rhythm.downbeats),
    }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    for warning in outcome.features.measurements.diagnostics.warnings:
        print(f"setvector: warning: {warning}", file=sys.stderr)
    if not rhythm.reliable:
        print(
            f"setvector: warning: no reliable beat grid: {'; '.join(rhythm.reasons)}",
            file=sys.stderr,
        )
```

Also change the `analyze` subparser `help` to `"Extract baseline features and a beat grid from a local audio file"`.

- [ ] **Step 5: Run the tests**

Run: `py -m pytest tests/test_application_analyze.py tests/test_cli.py -q`
Expected: all pass.

- [ ] **Step 6: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/application/analyze.py src/setvector/cli/__init__.py tests/test_application_analyze.py tests/test_cli.py
git commit -m "feat(analyze): save a rhythm artifact with every analysis"
```

---

### Task 11: Draw real bars in reports

**Files:**
- Modify: `src/setvector/visualization/model.py`
- Modify: `src/setvector/visualization/assets/report.js:376`
- Modify: `src/setvector/application/report.py`
- Test: `tests/test_visualization_model.py`, `tests/test_application_report.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_visualization_model.py` (reuse its existing imports; add `from dataclasses import replace`, `import pytest`, and `from setvector.visualization import build_report_model` at the top if they are not already imported):

```python
def test_reliable_rhythm_supplies_beats_downbeats_and_tempo(report_inputs, rhythm_factory):
    asset, bundle = report_inputs(frames=40)
    rhythm = rhythm_factory(bundle)
    model = build_report_model(asset, bundle, rhythm)
    assert model.beats == rhythm.beats
    assert model.downbeats == rhythm.downbeats
    assert model.tempo_bpm == rhythm.tempo_bpm
    assert not any("beat grid" in w or "rhythm" in w for w in model.warnings)


def test_unreliable_rhythm_keeps_baseline_beats_and_says_why(report_inputs, rhythm_factory):
    asset, bundle = report_inputs(frames=40)
    model = build_report_model(asset, bundle, rhythm_factory(bundle, source="none"))
    assert model.beats == tuple(b.seconds for b in bundle.measurements.beats)
    assert model.downbeats == ()
    assert any(w.startswith("No reliable beat grid: beat_this: 3 beats") for w in model.warnings)


def test_missing_rhythm_keeps_baseline_beats_with_a_warning(report_inputs):
    asset, bundle = report_inputs(frames=40)
    model = build_report_model(asset, bundle)
    assert model.downbeats == ()
    assert any("No rhythm analysis" in w for w in model.warnings)


def test_rhythm_from_another_feature_is_rejected(report_inputs, rhythm_factory):
    asset, bundle = report_inputs(frames=40)
    foreign = replace(rhythm_factory(bundle), feature_id="b" * 64)
    with pytest.raises(ValueError, match="feature_id"):
        build_report_model(asset, bundle, foreign)
```

Append to `tests/test_application_report.py`:

```python
def test_report_uses_the_stored_rhythm(monkeypatch, analyzed):
    store, outcome = analyzed
    captured = {}
    import setvector.application.report as report_module

    real_build = report_module.build_report_model

    def spy(asset, bundle, rhythm=None):
        captured["rhythm"] = rhythm
        return real_build(asset, bundle, rhythm)

    monkeypatch.setattr(report_module, "build_report_model", spy)
    render_report(outcome.features.feature_id, store, include_audio=False)
    assert captured["rhythm"] == outcome.rhythm
```

- [ ] **Step 2: Run to verify they fail**

Run: `py -m pytest tests/test_visualization_model.py tests/test_application_report.py -q`
Expected: failures — `build_report_model()` takes 2 positional arguments; the spy receives `rhythm=None`.

- [ ] **Step 3: Accept a rhythm in `build_report_model`**

In `src/setvector/visualization/model.py`, import `RhythmAnalysis` from `setvector.domain`, add constants below `BRIGHTNESS_TIP`:

```python
NO_RHYTHM_WARNING = (
    "No rhythm analysis matches this installation, so beats come from the baseline tracker "
    "and bar lines are not shown. Run analyze again to add one."
)
```

and change the function:

```python
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
```

- [ ] **Step 4: Stop drawing every fourth beat as a bar**

In `src/setvector/visualization/assets/report.js` line 376, replace:

```js
      const bar = barLines ? barLines.has(beat) : index % 4 === 0;
```

with:

```js
      const bar = barLines !== null && barLines.has(beat);
```

If `index` is now unused in that callback, change `model.beats.forEach((beat, index) => {` to `model.beats.forEach((beat) => {`.

- [ ] **Step 5: Load the rhythm in `render_report`**

In `src/setvector/application/report.py`, add imports:

```python
from setvector.analysis import rhythm_identity
from setvector.storage import ArtifactStore, RhythmStore, compute_rhythm_id, write_report
```

(replacing the existing `setvector.storage` import), and after `asset, bundle = store.load_stored(feature_id)` add:

```python
    rhythm_id = compute_rhythm_id(bundle.feature_id, rhythm_identity(bundle.extractor))
    rhythm = RhythmStore(store.workspace).load(rhythm_id)
```

Change the render line to `html = render_report_html(build_report_model(asset, bundle, rhythm), preview)`.

- [ ] **Step 6: Run the report tests**

Run: `py -m pytest tests/test_visualization_model.py tests/test_visualization_html.py tests/test_visualization_assets.py tests/test_application_report.py -q`
Expected: all pass. If an existing test asserted the exact `warnings` tuple of a model built without a rhythm, add `NO_RHYTHM_WARNING` to its expectation rather than removing the warning.

- [ ] **Step 7: Full checks and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
git add src/setvector/visualization src/setvector/application/report.py tests/test_visualization_model.py tests/test_application_report.py
git commit -m "feat(report): draw bar lines from detected downbeats"
```

---

### Task 12: Offline guarantee, documentation, and real-track check

**Files:**
- Modify: `tests/test_offline_analysis.py`
- Modify: `docs/architecture.md`, `docs/research/analysis-engine-extension.md`, `docs/development.md`, `README.md`

- [ ] **Step 1: Extend the offline test**

In `tests/test_offline_analysis.py`, change the fixture to also isolate PyTorch's cache:

```python
@pytest.fixture
def offline_environment(tmp_path):
    blocker = tmp_path / "network_blocker"
    blocker.mkdir()
    (blocker / "sitecustomize.py").write_text(BLOCKER, encoding="utf-8")
    torch_home = tmp_path / "torch home"
    torch_home.mkdir()
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(blocker)
    environment["TORCH_HOME"] = str(torch_home)
    return environment
```

In `test_analyze_and_cache_work_with_network_sockets_blocked`, after the `second` assertions add:

```python
    assert json.loads(first.stdout)["rhythm_source"] in ("beat_this", "setvector_fallback", "none")
    assert json.loads(second.stdout)["rhythm_id"] == json.loads(first.stdout)["rhythm_id"]
    assert list((tmp_path / "torch home").iterdir()) == []
```

Run: `py -m pytest tests/test_offline_analysis.py -q`
Expected: 2 passed. This runs the real model with sockets blocked.

- [ ] **Step 2: Update `docs/architecture.md`**

Replace the sentence `Future learned models must load from explicit local artifacts.` with:

```markdown
Learned models load only from explicit, hash-verified local artifacts. Beat and downbeat detection uses the Beat This! checkpoint bundled with the package and CPU PyTorch; neither downloads anything at run time.
```

- [ ] **Step 3: Update `docs/research/analysis-engine-extension.md`**

Replace `If tested, require an explicit local checkpoint, record its hash, and keep PyTorch and weights outside core dependencies.` with:

```markdown
SetVector now bundles its `final0` checkpoint, verifies its SHA-256 before loading, and treats PyTorch as a core dependency; see the [Rhythm Engine Design](../superpowers/specs/2026-09-23-rhythm-engine-design.md).
```

- [ ] **Step 4: Update `docs/development.md`**

In **Setup**, insert the fetch step before the editable install:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/fetch_model.py
.\.venv\Scripts\python.exe -m pip install --no-build-isolation -e .
.\.venv\Scripts\setvector.exe --help
```

Replace the runtime-dependency sentence with:

```markdown
`requirements-dev.txt` pins development, build, and runtime dependencies. The runtime dependencies (Beat This!, PyTorch, torchaudio, NumPy, SciPy, SoundFile, librosa, soxr, and Beat This!'s helpers) are pinned exactly in `pyproject.toml` because their versions are part of every artifact's identity.

`scripts/fetch_model.py` downloads the 81 MB Beat This! checkpoint into `src/setvector/models/` once and verifies its SHA-256. Git ignores it; builds fail without it, and wheels include it. CPU PyTorch adds about 550 MB to an environment on Windows. On Linux, install with `--extra-index-url https://download.pytorch.org/whl/cpu`, because the default PyPI build of PyTorch includes several gigabytes of CUDA libraries.
```

In **Workspace layout**, add the rhythm artifact to the tree and a sentence after the NPZ paragraph:

```text
<workspace>/
  assets/<asset-id>/asset.json
  features/<feature-id>/manifest.json
  features/<feature-id>/arrays.npz
  rhythm/<rhythm-id>/rhythm.json
```

```markdown
`rhythm.json` holds the chosen beat grid (constant-tempo segments, grid beats, and their bar positions), the detector's raw beats, each candidate's quality measurements, and the reasons any candidate was rejected. Its source is `beat_this`, `setvector_fallback` (beats without bars), or `none`.
```

- [ ] **Step 5: Update `README.md` Getting Started**

Change the first paragraph's list to end with `...onset strength, and a beat grid with downbeats detected by the bundled Beat This! model.` Insert `.\.venv\Scripts\python.exe scripts/fetch_model.py` before `pip install .` in the PowerShell block, and extend the paragraph after it:

```markdown
`analyze` prints the asset ID, feature ID, cache status, and manifest path, plus the beat grid's rhythm ID, source, reliability, and downbeat count.
```

(Replace the existing sentence that begins `` `analyze` prints``.)

- [ ] **Step 6: Full checks, build, and commit**

```powershell
py -m pytest -q; py -m ruff check .; py -m ruff format --check .
py -m build --no-isolation
git add tests/test_offline_analysis.py docs/architecture.md docs/research/analysis-engine-extension.md docs/development.md README.md
git commit -m "docs: describe the required Beat This! model and rhythm artifacts"
```

Delete `dist\` after confirming the build succeeded.

- [ ] **Step 7: Real-track check (manual, no commit)**

Analyze the three spike tracks into a fresh workspace and render their reports:

```powershell
$tracks = "C:\Users\aryan\AppData\Local\Temp\claude\C--Users-aryan-OneDrive-Documents-GitHub-set-vector\5bcfcde1-8200-4ddf-a557-af4797d9a1c1\scratchpad\dj-tracks"
$ws = "$env:TEMP\setvector-rhythm-check"
Get-ChildItem $tracks -Filter *.mp3 | ForEach-Object {
  .\.venv\Scripts\setvector.exe analyze $_.FullName --config examples/analysis-config.json --workspace $ws
}
```

Expected, and report each result:
- "I Wish": `rhythm_source` `beat_this`, `rhythm_reliable` true, about 130 downbeats; `rhythm.json` tempo within 0.05 of 124.00.
- "Moth To A Flame": `beat_this`, about 160–170 downbeats; tempo within 0.05 of 126.00.
- The acapella: `setvector_fallback` or `none`, with a `beat_this:` reason on stderr.

Then run `setvector report <feature-id> --workspace $ws` for one club track, open the HTML, and confirm bar lines fall on the first beat of each bar (the hi-hats enter at 0:15 in "Moth To A Flame", on a bar line).
```
