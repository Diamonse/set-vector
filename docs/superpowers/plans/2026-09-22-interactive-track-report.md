# Interactive Track Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `setvector report`, which renders a stored feature artifact as a self-contained, offline HTML page with an embedded player, a colored overview scrubber, and four synchronized close-up lanes.

**Architecture:** Storage gains a lookup by feature ID and an atomic report writer. Ingestion gains a verified, browser-playable audio preview. A new `visualization` package turns `(AudioAsset, FeatureBundle)` into a JSON-ready `ReportModel` and fills one HTML template with inlined CSS, JavaScript, the vendored uPlot build, the embedded Inter font, the model, and the audio. The application service coordinates these steps, and the CLI only parses options and maps errors.

**Tech Stack:** Python 3.11+, NumPy 2.4.6, SoundFile 0.14.0, soxr 1.1.0, uPlot 1.6.32 (vendored, MIT), Inter variable font from `@fontsource-variable/inter` 5.3.0 (vendored, OFL 1.1), vanilla JavaScript, pytest 9.1.1, Ruff 0.16.8

**Spec:** `docs/superpowers/specs/2026-09-22-interactive-track-report-design.md`

## Global Constraints

- Rendering and viewing make no network requests. The HTML contains no `http://`, `https://`, or protocol-relative references in `src`, `href`, `url(...)`, or `@import`.
- Never reanalyze audio to build a report. Embedded audio must hash to the artifact's `asset_id`.
- Visualization has no filesystem access except reading packaged assets through `importlib.resources`.
- Text from the artifact reaches the page only through `textContent`, escaped HTML, or JSON embedded with `<`, `>`, and `&` escaped.
- Expected failures map to exit 2 (caller input) or 1 (processing) without tracebacks and leave no partial report.
- Use Conventional Commit subjects with no trailers or assistant attribution. Keep commits local.

## File Structure

| File | Responsibility |
|---|---|
| `src/setvector/visualization/__init__.py` | Public `ReportModel`, `build_report_model`, `render_report_html` |
| `src/setvector/visualization/model.py` | Pure `(AudioAsset, FeatureBundle) -> ReportModel` |
| `src/setvector/visualization/html.py` | Template filling with inlined assets, model JSON, and audio |
| `src/setvector/visualization/assets/report.html` | Page structure with `{{PLACEHOLDER}}` slots |
| `src/setvector/visualization/assets/report.css` | Layout, typography, dark and light palettes |
| `src/setvector/visualization/assets/report.js` | Player, overview, uPlot lanes, zoom, theme |
| `src/setvector/visualization/assets/uPlot.iife.min.js`, `uPlot.min.css` | Vendored uPlot 1.6.32 |
| `src/setvector/visualization/assets/inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2` | Vendored Inter variable font subsets |
| `src/setvector/visualization/assets/LICENSES/uPlot-LICENSE.txt`, `Inter-OFL.txt` | Third-party license texts |
| `src/setvector/storage/artifacts.py` | Add `ArtifactStore.load_stored` and a shared asset reader |
| `src/setvector/storage/reports.py` | Atomic `write_report` |
| `src/setvector/ingestion/preview.py` | `PreviewAudio` and `load_preview` |
| `src/setvector/application/report.py` | `ReportOutcome` and `render_report` |
| `src/setvector/cli/__init__.py` | `report` command and shared error mapping |
| `tests/conftest.py` | `report_inputs` factory for synthetic bundles |
| `tests/test_visualization_assets.py`, `tests/test_visualization_model.py`, `tests/test_visualization_html.py`, `tests/test_storage_reports.py`, `tests/test_ingestion_preview.py`, `tests/test_application_report.py` | Focused tests |

---

### Task 1: Vendor the report's front-end assets

**Files:**
- Create: `src/setvector/visualization/__init__.py`
- Create: `src/setvector/visualization/assets/uPlot.iife.min.js`, `uPlot.min.css`
- Create: `src/setvector/visualization/assets/inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`
- Create: `src/setvector/visualization/assets/LICENSES/uPlot-LICENSE.txt`, `Inter-OFL.txt`
- Create: `tests/test_visualization_assets.py`
- Modify: `docs/superpowers/specs/2026-09-22-interactive-track-report-design.md`

- [ ] **Step 1: Write the failing asset test**

```python
"""Vendored front-end assets ship inside the package."""

from importlib.resources import files

import pytest

ASSETS = files("setvector.visualization").joinpath("assets")
VENDORED = (
    "uPlot.iife.min.js",
    "uPlot.min.css",
    "inter-latin-wght-normal.woff2",
    "inter-latin-ext-wght-normal.woff2",
    "LICENSES/uPlot-LICENSE.txt",
    "LICENSES/Inter-OFL.txt",
)


@pytest.mark.parametrize("name", VENDORED)
def test_vendored_asset_is_packaged(name):
    assert ASSETS.joinpath(name).is_file()


def test_vendored_versions_and_licenses():
    header = ASSETS.joinpath("uPlot.iife.min.js").read_text(encoding="utf-8")[:80]
    assert "(v1.6.32)" in header
    assert "MIT" in ASSETS.joinpath("LICENSES/uPlot-LICENSE.txt").read_text(encoding="utf-8")
    ofl = ASSETS.joinpath("LICENSES/Inter-OFL.txt").read_text(encoding="utf-8")
    assert "SIL Open Font License, Version 1.1" in ofl


def test_fonts_are_woff2():
    for name in ("inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"):
        assert ASSETS.joinpath(name).read_bytes()[:4] == b"wOF2"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_assets.py -q`

Expected: FAIL because `setvector.visualization` does not exist.

- [ ] **Step 3: Download the pinned packages into a temporary directory outside the repository and copy the files**

```bash
VENDOR="$(mktemp -d)"
( cd "$VENDOR" && npm pack uplot@1.6.32 @fontsource-variable/inter@5.3.0 --silent \
  && mkdir uplot inter && tar -xzf uplot-1.6.32.tgz -C uplot \
  && tar -xzf fontsource-variable-inter-5.3.0.tgz -C inter )
ASSETS=src/setvector/visualization/assets
mkdir -p "$ASSETS/LICENSES"
cp "$VENDOR/uplot/package/dist/uPlot.iife.min.js" "$VENDOR/uplot/package/dist/uPlot.min.css" "$ASSETS/"
cp "$VENDOR/inter/package/files/inter-latin-wght-normal.woff2" \
   "$VENDOR/inter/package/files/inter-latin-ext-wght-normal.woff2" "$ASSETS/"
cp "$VENDOR/uplot/package/LICENSE" "$ASSETS/LICENSES/uPlot-LICENSE.txt"
cp "$VENDOR/inter/package/LICENSE" "$ASSETS/LICENSES/Inter-OFL.txt"
```

Create `src/setvector/visualization/__init__.py`:

```python
"""Self-contained HTML reports built from stored feature artifacts."""
```

- [ ] **Step 4: Correct the font source in the spec**

In the spec's module table, replace ``Inter 4.1 `InterVariable.woff2` `` with ``the Inter variable font from `@fontsource-variable/inter` 5.3.0 (`inter-latin-wght-normal.woff2` and `inter-latin-ext-wght-normal.woff2`) ``.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_assets.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/setvector/visualization tests/test_visualization_assets.py docs/superpowers/specs
git commit -m "build(report): vendor uPlot and the Inter variable font"
```

---

### Task 2: Stored artifact lookup and atomic report writing

**Files:**
- Modify: `src/setvector/storage/artifacts.py`
- Create: `src/setvector/storage/reports.py`
- Modify: `src/setvector/storage/__init__.py`
- Modify: `tests/test_storage_artifacts.py`
- Create: `tests/test_storage_reports.py`

- [ ] **Step 1: Add failing `load_stored` tests to `tests/test_storage_artifacts.py`**

Add `InputError` to the `setvector.domain` import, then append:

```python
def test_load_stored_reads_asset_and_bundle_without_audio(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    stored_asset, stored_bundle = store.load_stored(bundle.feature_id)
    assert stored_bundle == bundle
    assert stored_asset == asset
    assert not Path(asset.observed_path).exists()


@pytest.mark.parametrize("feature_id", ["not-an-id", "F" * 64, "f" * 64])
def test_load_stored_rejects_malformed_or_unknown_ids(tmp_path, feature_id):
    with pytest.raises(InputError, match="feature"):
        ArtifactStore(tmp_path).load_stored(feature_id)


def test_load_stored_reports_corrupt_artifacts(tmp_path, asset, bundle):
    store = ArtifactStore(tmp_path)
    store.save(asset, bundle)
    (tmp_path / "assets" / asset.asset_id / "asset.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(ArtifactError, match="asset metadata"):
        store.load_stored(bundle.feature_id)
    store.manifest_path(bundle.feature_id).write_text("{broken", encoding="utf-8")
    with pytest.raises(ArtifactError, match="corrupt"):
        store.load_stored(bundle.feature_id)
```

- [ ] **Step 2: Write failing report-writer tests in `tests/test_storage_reports.py`**

```python
"""Atomic report files that never replace existing work by accident."""

import os

import pytest

import setvector.storage.reports as reports_module
from setvector.domain import ArtifactError, InputError
from setvector.storage import write_report


def test_write_report_creates_parents_and_returns_absolute_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    path = write_report("reports dir/näme.html", "<p>ok</p>")
    assert path == (tmp_path / "reports dir" / "näme.html").resolve()
    assert path.read_text(encoding="utf-8") == "<p>ok</p>"


def test_existing_report_is_kept_without_overwrite(tmp_path):
    target = tmp_path / "report.html"
    target.write_text("original", encoding="utf-8")
    with pytest.raises(InputError, match="--overwrite"):
        write_report(target, "new")
    assert target.read_text(encoding="utf-8") == "original"
    assert write_report(target, "new", overwrite=True).read_text(encoding="utf-8") == "new"


def test_directory_target_is_rejected(tmp_path):
    with pytest.raises(InputError, match="directory"):
        write_report(tmp_path, "x", overwrite=True)


def test_failed_replace_leaves_no_file_behind(tmp_path, monkeypatch):
    def failing_replace(source, target):
        raise OSError("simulated")

    monkeypatch.setattr(reports_module.os, "replace", failing_replace)
    with pytest.raises(ArtifactError, match="cannot write report"):
        write_report(tmp_path / "report.html", "x")
    assert os.listdir(tmp_path) == []
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_storage_artifacts.py tests/test_storage_reports.py -q`

Expected: FAIL: `load_stored` is missing and `write_report` cannot be imported.

- [ ] **Step 4: Implement `load_stored` with a shared asset reader**

In `src/setvector/storage/artifacts.py`, change the domain import to `from setvector.domain import ArtifactError, AudioAsset, FeatureBundle, InputError`, add this method after `load`:

```python
class ArtifactStore:  # existing class; add this method
    def load_stored(self, feature_id: str) -> tuple[AudioAsset, FeatureBundle]:
        """Return the stored asset and bundle for ``feature_id`` without reading any audio."""
        try:
            directory = self._feature_directory(feature_id)
        except ValueError as error:
            raise InputError(f"invalid feature ID {feature_id!r}: {error}") from error
        if not directory.exists():
            raise InputError(f"no feature artifact {feature_id} in workspace {self.workspace}")
        bundle = _read_feature_directory(directory, feature_id)
        return self._read_asset(bundle.asset_id), bundle
```

and replace `_check_asset` with:

```python
class ArtifactStore:  # existing class; replace _check_asset with these methods
    def _read_asset(self, asset_id: str) -> AudioAsset:
        path = self._asset_path(asset_id)
        if not path.is_file():
            raise ArtifactError(f"asset metadata is missing for {asset_id}: {path}")
        try:
            stored = AudioAsset.from_dict(_read_json(path))
        except (OSError, ValueError, TypeError) as error:
            raise ArtifactError(
                f"asset metadata for {asset_id} is corrupt or incompatible: {error}"
            ) from error
        if stored.asset_id != asset_id:
            raise ArtifactError(f"asset metadata for {asset_id} records a different asset_id")
        return stored

    def _check_asset(self, expected: AudioAsset) -> None:
        stored = self._read_asset(expected.asset_id)
        if _asset_identity(stored) != _asset_identity(expected):
            raise ArtifactError(
                f"asset metadata for {expected.asset_id} does not match the inspected audio"
            )
```

- [ ] **Step 5: Implement `src/setvector/storage/reports.py`**

```python
"""Atomic writes for generated report files."""

import os
import tempfile
from pathlib import Path

from setvector.domain import ArtifactError, InputError


def write_report(path: str | Path, html: str, overwrite: bool = False) -> Path:
    """Write ``html`` to ``path`` through a temporary sibling file and return the absolute path.

    An existing file is replaced only when ``overwrite`` is true.
    """
    target = Path(path).resolve()
    if target.is_dir():
        raise InputError(f"report path is a directory: {target}")
    if target.exists() and not overwrite:
        raise InputError(f"report already exists: {target}; pass --overwrite to replace it")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
    except OSError as error:
        raise ArtifactError(f"cannot write report {target}: {error}") from error
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(html.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        raise ArtifactError(f"cannot write report {target}: {error}") from error
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return target
```

Export it from `src/setvector/storage/__init__.py`:

```python
"""Local artifact persistence and canonical identities."""

from .artifacts import ArtifactStore
from .canonical import canonical_json, compute_feature_id, strict_json_loads
from .reports import write_report

__all__ = [
    "ArtifactStore",
    "canonical_json",
    "compute_feature_id",
    "strict_json_loads",
    "write_report",
]
```

- [ ] **Step 6: Run the storage tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_storage_artifacts.py tests/test_storage_reports.py -q`

Expected: PASS, including every earlier storage test.

- [ ] **Step 7: Lint and commit**

Run: `.venv/Scripts/python.exe -m ruff check src tests && .venv/Scripts/python.exe -m ruff format --check src tests`

```bash
git add src/setvector/storage tests/test_storage_artifacts.py tests/test_storage_reports.py
git commit -m "feat(storage): load artifacts by feature ID and write reports atomically"
```

---

### Task 3: Verified audio preview

**Files:**
- Create: `src/setvector/ingestion/preview.py`
- Modify: `src/setvector/ingestion/__init__.py`
- Create: `tests/test_ingestion_preview.py`

- [ ] **Step 1: Write failing preview tests**

```python
"""Browser-playable previews of exactly the analyzed audio."""

import io

import numpy as np
import pytest
import soundfile as sf

from setvector.domain import DecodeError, InputError
from setvector.ingestion import PreviewAudio, inspect_audio, load_preview


def tone(rate, seconds, channels):
    t = np.arange(int(rate * seconds)) / rate
    column = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    return np.repeat(column[:, None], channels, axis=1)


def test_mp3_bytes_pass_through_unchanged(tmp_path):
    path = tmp_path / "track.mp3"
    sf.write(path, tone(44_100, 1.0, 2), 44_100, format="MP3", subtype="MPEG_LAYER_III")
    preview = load_preview(path, inspect_audio(path))
    assert preview == PreviewAudio("audio/mpeg", path.read_bytes())


@pytest.mark.parametrize(
    "rate, channels, expected_rate, expected_channels",
    [(8_000, 1, 8_000, 1), (44_100, 2, 44_100, 2), (96_000, 2, 48_000, 2), (48_000, 3, 48_000, 1)],
)
def test_other_formats_become_mp3_of_the_same_length(
    tmp_path, rate, channels, expected_rate, expected_channels
):
    path = tmp_path / "track.wav"
    sf.write(path, tone(rate, 1.0, channels), rate, subtype="PCM_16")
    source_bytes = path.read_bytes()
    preview = load_preview(path, inspect_audio(path))
    assert preview.mime_type == "audio/mpeg"
    decoded, decoded_rate = sf.read(io.BytesIO(preview.data), always_2d=True)
    assert decoded_rate == expected_rate
    assert decoded.shape[1] == expected_channels
    assert decoded.shape[0] / decoded_rate == pytest.approx(1.0, abs=1152 / expected_rate)
    assert path.read_bytes() == source_bytes


def test_missing_and_mismatched_files_are_input_errors(tmp_path):
    path = tmp_path / "track.wav"
    sf.write(path, tone(8_000, 0.5, 1), 8_000)
    asset = inspect_audio(path)
    with pytest.raises(InputError, match="does not exist"):
        load_preview(tmp_path / "moved.wav", asset)
    other = tmp_path / "other.wav"
    sf.write(other, tone(8_000, 0.6, 1), 8_000)
    with pytest.raises(InputError, match="not the audio that was analyzed"):
        load_preview(other, asset)


def test_decoder_failure_is_a_decode_error(tmp_path, monkeypatch):
    path = tmp_path / "track.wav"
    sf.write(path, tone(8_000, 0.5, 1), 8_000)
    asset = inspect_audio(path)

    def failing_read(*args, **kwargs):
        raise sf.LibsndfileError(1, "simulated")

    monkeypatch.setattr(sf, "read", failing_read)
    with pytest.raises(DecodeError, match="decode"):
        load_preview(path, asset)
```

- [ ] **Step 2: Run and confirm failure**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingestion_preview.py -q`

Expected: FAIL because `load_preview` cannot be imported.

- [ ] **Step 3: Implement `src/setvector/ingestion/preview.py`**

```python
"""Browser-playable audio for reports, verified against the analyzed content."""

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile
import soxr

from setvector.domain import AudioAsset, DecodeError, InputError

from .audio import _resolve_file

_MP3_RATES = (8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000)


@dataclass(frozen=True, slots=True)
class PreviewAudio:
    """Encoded audio bytes and the MIME type a browser needs to play them."""

    mime_type: str
    data: bytes


def load_preview(path: str | Path, asset: AudioAsset) -> PreviewAudio:
    """Return playable audio for ``asset`` after proving ``path`` holds the same bytes.

    MP3 content is returned unchanged. Other formats are decoded from the verified
    bytes and encoded to MP3 in memory; the source file is never modified.
    """
    resolved = _resolve_file(path)
    try:
        data = resolved.read_bytes()
    except OSError as error:
        raise InputError(f"cannot read audio file {resolved}: {error}") from error
    if hashlib.sha256(data).hexdigest() != asset.asset_id:
        raise InputError(
            f"{resolved} is not the audio that was analyzed; "
            f"its content differs from asset {asset.asset_id}"
        )
    if asset.format == "MP3":
        return PreviewAudio("audio/mpeg", data)
    return PreviewAudio("audio/mpeg", _encode_mp3(data, resolved))


def _encode_mp3(data: bytes, source: Path) -> bytes:
    try:
        samples, rate = soundfile.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except (soundfile.SoundFileError, RuntimeError) as error:
        raise DecodeError(f"cannot decode audio file {source}: {error}") from error
    if samples.shape[1] > 2:
        samples = samples.mean(axis=1, keepdims=True, dtype=np.float32)
    target = rate if rate in _MP3_RATES else next((r for r in _MP3_RATES if r >= rate), 48_000)
    if target != rate:
        samples = soxr.resample(samples, rate, target, quality="HQ")
    buffer = io.BytesIO()
    try:
        soundfile.write(buffer, samples, target, format="MP3", subtype="MPEG_LAYER_III")
    except (soundfile.SoundFileError, RuntimeError, ValueError) as error:
        raise DecodeError(f"cannot encode an MP3 preview of {source}: {error}") from error
    return buffer.getvalue()
```

Update `src/setvector/ingestion/__init__.py`:

```python
"""Local audio inspection, decoding, and report previews."""

from .audio import DecodedAudio, decode_audio, inspect_audio
from .preview import PreviewAudio, load_preview

__all__ = ["DecodedAudio", "PreviewAudio", "decode_audio", "inspect_audio", "load_preview"]
```

- [ ] **Step 4: Run the preview and ingestion tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_ingestion_preview.py tests/test_ingestion.py -q`

Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
git add src/setvector/ingestion tests/test_ingestion_preview.py
git commit -m "feat(ingestion): build verified audio previews for reports"
```

---

### Task 4: Report model

**Files:**
- Create: `src/setvector/visualization/model.py`
- Modify: `src/setvector/visualization/__init__.py`
- Modify: `tests/conftest.py`
- Create: `tests/test_visualization_model.py`

- [ ] **Step 1: Add the `report_inputs` factory to `tests/conftest.py`**

Add these imports next to the existing ones:

```python
from setvector.domain import (
    AnalysisConfig,
    AnalysisDiagnostics,
    AnalysisMeasurements,
    AudioAsset,
    BeatPosition,
    ExtractorIdentity,
    FeatureBundle,
    FeatureSeries,
)
from setvector.storage import compute_feature_id
```

and append:

```python
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
                sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono"
            ),
            parameters={"bass_cutoff_hz": 250.0},
            dependency_versions={"librosa": "0.11.0", "numpy": "2.4.6"},
        )
        asset = AudioAsset(
            asset_id="a" * 64,
            observed_path=str((tmp_path / name).resolve()),
            byte_size=1_000,
            duration_seconds=frames * 0.5 + 0.1,
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
```

- [ ] **Step 2: Write failing model tests in `tests/test_visualization_model.py`**

```python
"""The data embedded in a report is faithful, compact, and JSON-safe."""

import base64
import json
from dataclasses import replace

import numpy as np
import pytest

from setvector.visualization import build_report_model
from setvector.visualization.model import parse_title


def decode(text, dtype):
    return np.frombuffer(base64.b64decode(text), dtype=dtype)


def test_series_round_trip_with_gaps(report_inputs):
    asset, bundle = report_inputs(frames=4, missing=(0, 2))
    model = build_report_model(asset, bundle)
    np.testing.assert_array_equal(
        decode(model.timestamps, "<f8"), bundle.measurements.rms.timestamps
    )
    by_name = {s.name: s for s in model.series}
    assert set(by_name) == {"rms", "bass_power_ratio", "spectral_centroid", "onset_strength"}
    centroid = decode(by_name["spectral_centroid"].values, "<f4")
    assert np.isnan(centroid[0]) and np.isnan(centroid[2])
    assert centroid[1] == pytest.approx(1100.0)
    assert by_name["rms"].unit == "linear_amplitude"


def test_summary_medians_bands_and_bars(report_inputs):
    asset, bundle = report_inputs(frames=4)
    summary = build_report_model(asset, bundle).summary
    assert summary.bass_median == pytest.approx(0.15)
    assert summary.bass_band == "Light"
    assert summary.centroid_median == pytest.approx(1150.0)
    assert summary.brightness_band == "Dark"
    assert summary.bar_estimate == round(2.1 * 120 / 240)
    assert "not a calibrated judgment" in summary.bass_tip


@pytest.mark.parametrize(
    "median, band", [(0.29, "Light"), (0.3, "Moderate"), (0.59, "Moderate"), (0.6, "Heavy")]
)
def test_bass_band_edges(median, band):
    from setvector.visualization.model import BASS_BANDS, band_for

    assert band_for(median, BASS_BANDS) == band


def test_silence_and_missing_tempo_have_no_summary_values(report_inputs):
    asset, bundle = report_inputs(frames=3, missing=(0, 1, 2), beat_frames=())
    model = build_report_model(asset, bundle)
    assert model.tempo_bpm is None
    assert model.beats == ()
    assert model.summary.bass_median is None
    assert model.summary.bass_band is None
    assert model.summary.brightness_band is None
    assert model.summary.bar_estimate is None


def test_empty_series_are_supported(report_inputs):
    asset, bundle = report_inputs(frames=0, beat_frames=(), warnings=("too short",))
    model = build_report_model(asset, bundle)
    assert decode(model.timestamps, "<f8").size == 0
    assert model.warnings == ("too short",)


def test_model_is_strict_json(report_inputs):
    asset, bundle = report_inputs(frames=4, missing=(1,))
    data = build_report_model(asset, bundle).to_dict()
    text = json.dumps(data, allow_nan=False)
    assert json.loads(text)["downbeats"] == []
    assert data["feature_id"] == bundle.feature_id


def test_provenance_facts_and_format_line(report_inputs):
    asset, bundle = report_inputs(sample_rate=44_100, channels=2)
    model = build_report_model(asset, bundle)
    facts = dict(model.facts)
    assert facts["Feature ID"] == bundle.feature_id
    assert facts["Frame / hop"] == "2,048 / 512 samples"
    assert facts["Channels"] == "Mixed to mono"
    assert "librosa 0.11.0" in facts["Libraries"]
    assert model.format_line == "MP3 · 44.1 kHz · stereo"
    assert model.beats == (bundle.measurements.beats[0].seconds,)


@pytest.mark.parametrize(
    "stem, expected",
    [
        ("Artist - Title", ("Title", "Artist")),
        ("A - B - C", ("B - C", "A")),
        ("Solo Track", ("Solo Track", None)),
        (" - Title", (" - Title", None)),
        ("トラック - 名前", ("名前", "トラック")),
    ],
)
def test_parse_title(tmp_path, stem, expected):
    assert parse_title(str(tmp_path / f"{stem}.mp3")) == expected


def test_mismatched_asset_is_rejected(report_inputs):
    asset, bundle = report_inputs()
    with pytest.raises(ValueError, match="asset_id"):
        build_report_model(replace(asset, asset_id="b" * 64), bundle)
```

- [ ] **Step 3: Run and confirm failure**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_model.py -q`

Expected: FAIL because `build_report_model` cannot be imported.

- [ ] **Step 4: Implement `src/setvector/visualization/model.py`**

```python
"""Transform stored features into the data embedded in a track report."""

import base64
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from setvector.domain import AudioAsset, FeatureBundle, FeatureSeries

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


def build_report_model(asset: AudioAsset, bundle: FeatureBundle) -> ReportModel:
    """Describe ``bundle`` for display without reading files or recomputing features."""
    if asset.asset_id != bundle.asset_id:
        raise ValueError("asset_id of the asset and bundle must match")
    measurements = bundle.measurements
    title, artist = parse_title(asset.observed_path)
    bass = _median(measurements.bass_power_ratio)
    centroid = _median(measurements.spectral_centroid)
    tempo = measurements.tempo_bpm
    duration = asset.duration_seconds
    return ReportModel(
        feature_id=bundle.feature_id,
        asset_id=bundle.asset_id,
        title=title,
        artist=artist,
        format_line=_format_line(asset),
        duration_seconds=duration,
        tempo_bpm=tempo,
        beats=tuple(beat.seconds for beat in measurements.beats),
        downbeats=(),
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
        warnings=measurements.diagnostics.warnings,
        facts=_facts(bundle),
    )
```

Update `src/setvector/visualization/__init__.py`:

```python
"""Self-contained HTML reports built from stored feature artifacts."""

from .model import ReportModel, build_report_model

__all__ = ["ReportModel", "build_report_model"]
```

- [ ] **Step 5: Run the model tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_model.py -q`

Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
git add src/setvector/visualization tests/conftest.py tests/test_visualization_model.py
git commit -m "feat(report): describe stored features for display"
```

---

### Task 5: HTML renderer and report page

**Files:**
- Create: `src/setvector/visualization/html.py`
- Create: `src/setvector/visualization/assets/report.html`, `report.css`, `report.js`
- Modify: `src/setvector/visualization/__init__.py`
- Create: `tests/test_visualization_html.py`
- Modify: `tests/test_visualization_assets.py`

- [ ] **Step 1: Write failing renderer tests in `tests/test_visualization_html.py`**

```python
"""Report pages are self-contained, escaped, and bounded in size."""

import base64
import json
import re

import pytest

from setvector.ingestion import PreviewAudio
from setvector.visualization import build_report_model, render_report_html
from setvector.visualization.html import json_for_script, raw_text

EXTERNAL = [
    re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//""", re.I),
    re.compile(r"""url\(\s*["']?\s*(?:https?:)?//""", re.I),
    re.compile(r"@import", re.I),
]


def script_content(page, element_id):
    match = re.search(rf'<script id="{element_id}"[^>]*>(.*?)</script>', page, re.S)
    assert match, element_id
    return match.group(1)


@pytest.fixture
def page(report_inputs):
    asset, bundle = report_inputs(frames=8, missing=(3,))
    return render_report_html(build_report_model(asset, bundle)), bundle


def test_page_is_self_contained(page):
    html, _ = page
    for pattern in EXTERNAL:
        assert not pattern.search(html), pattern.pattern
    assert "data:font/woff2;base64," in html
    assert "var uPlot=function()" in html
    assert not re.search(r"\{\{[A-Z_]+\}\}", html)


def test_model_json_is_embedded_intact(page, report_inputs):
    html, bundle = page
    asset, same_bundle = report_inputs(frames=8, missing=(3,))
    expected = json.loads(json.dumps(build_report_model(asset, same_bundle).to_dict()))
    assert json.loads(script_content(html, "sv-model")) == expected
    assert bundle.feature_id in html


def test_audio_is_embedded_only_when_given(report_inputs):
    asset, bundle = report_inputs()
    model = build_report_model(asset, bundle)
    silent = render_report_html(model)
    assert script_content(silent, "sv-audio") == ""
    audio = PreviewAudio("audio/mpeg", b"\xff\xfb\x90\x00fake mp3")
    loud = render_report_html(model, audio)
    assert base64.b64decode(script_content(loud, "sv-audio")) == audio.data
    assert 'data-mime="audio/mpeg"' in loud


def test_title_text_is_escaped(report_inputs):
    asset, bundle = report_inputs(name='DJ <i> - <b>Tune & "Co".wav')
    html = render_report_html(build_report_model(asset, bundle))
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    assert title == "&lt;b&gt;Tune &amp; &quot;Co&quot; · SetVector report"
    model_json = script_content(html, "sv-model")
    assert "<" not in model_json and "&" not in model_json
    assert json.loads(model_json)["artist"] == "DJ <i>"


def test_script_json_cannot_close_its_element():
    hostile = "</script><!-- & \u2028\u2029"
    text = json_for_script({"title": hostile})
    assert not any(c in text for c in "<>&\u2028\u2029")
    assert json.loads(text) == {"title": hostile}


@pytest.mark.parametrize("element", ["script", "style"])
def test_raw_text_rejects_closing_tags(element):
    with pytest.raises(ValueError, match=element):
        raw_text(f"a</{element.upper()}>b", element)


def test_six_minute_report_without_audio_is_small(report_inputs):
    asset, bundle = report_inputs(frames=31_004, beat_frames=range(0, 31_004, 41))
    html = render_report_html(build_report_model(asset, bundle))
    assert len(html.encode("utf-8")) < 2_000_000
```

Test filenames avoid `/` and `\` because they separate path components.

- [ ] **Step 2: Add a JavaScript syntax test to `tests/test_visualization_assets.py`**

```python
import shutil
import subprocess


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_report_script_is_valid_javascript(tmp_path):
    script = tmp_path / "report.js"
    script.write_text(ASSETS.joinpath("report.js").read_text(encoding="utf-8"), encoding="utf-8")
    result = subprocess.run(
        ["node", "--check", str(script)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
```

Add a test that the report sources are packaged:

```python
@pytest.mark.parametrize("name", ["report.html", "report.css", "report.js"])
def test_report_sources_are_packaged(name):
    assert ASSETS.joinpath(name).is_file()
```

- [ ] **Step 3: Run and confirm failure**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_html.py tests/test_visualization_assets.py -q`

Expected: FAIL because `render_report_html` and the report sources do not exist.

- [ ] **Step 4: Implement `src/setvector/visualization/html.py`**

```python
"""Assemble one self-contained report page from the model, packaged assets, and audio."""

import base64
import html
import json
import re
from importlib.resources import files

from setvector.ingestion import PreviewAudio

from .model import ReportModel

_ASSETS = files("setvector.visualization").joinpath("assets")
_PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")
_FONTS = (
    (
        "inter-latin-wght-normal.woff2",
        "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,"
        "U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    ),
    (
        "inter-latin-ext-wght-normal.woff2",
        "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,"
        "U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,"
        "U+2C60-2C7F,U+A720-A7FF",
    ),
)


def _asset_text(name: str) -> str:
    return _ASSETS.joinpath(name).read_text(encoding="utf-8")


def _asset_base64(name: str) -> str:
    return base64.b64encode(_ASSETS.joinpath(name).read_bytes()).decode("ascii")


def raw_text(content: str, element: str) -> str:
    """Return content for a ``<script>`` or ``<style>`` element, refusing early closure."""
    if f"</{element}" in content.lower():
        raise ValueError(f"content would close its <{element}> element")
    return content


def json_for_script(value: object) -> str:
    """Serialize JSON that is inert inside an HTML ``<script>`` element."""
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    return (
        text.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _font_css() -> str:
    return "".join(
        '@font-face{font-family:"SetVector Inter";font-style:normal;font-display:swap;'
        f"font-weight:100 900;src:url(data:font/woff2;base64,{_asset_base64(name)}) "
        f'format("woff2");unicode-range:{ranges}}}'
        for name, ranges in _FONTS
    )


def render_report_html(model: ReportModel, audio: PreviewAudio | None = None) -> str:
    """Return the complete report page; it references nothing outside itself."""
    values = {
        "TITLE": html.escape(f"{model.title} · SetVector report"),
        "FONT_CSS": _font_css(),
        "UPLOT_CSS": raw_text(_asset_text("uPlot.min.css"), "style"),
        "REPORT_CSS": raw_text(_asset_text("report.css"), "style"),
        "MODEL_JSON": json_for_script(model.to_dict()),
        "AUDIO_TYPE": html.escape(audio.mime_type if audio else "", quote=True),
        "AUDIO_DATA": base64.b64encode(audio.data).decode("ascii") if audio else "",
        "UPLOT_JS": raw_text(_asset_text("uPlot.iife.min.js"), "script"),
        "REPORT_JS": raw_text(_asset_text("report.js"), "script"),
    }
    return _PLACEHOLDER.sub(lambda match: values[match.group(1)], _asset_text("report.html"))
```

The template is scanned once, so placeholder-like text inside inserted assets is never replaced.

Update `src/setvector/visualization/__init__.py`:

```python
"""Self-contained HTML reports built from stored feature artifacts."""

from .html import render_report_html
from .model import ReportModel, build_report_model

__all__ = ["ReportModel", "build_report_model", "render_report_html"]
```

- [ ] **Step 5: Create `src/setvector/visualization/assets/report.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="SetVector">
<title>{{TITLE}}</title>
<!--
  Generated by SetVector. Embedded third-party components:
  uPlot 1.6.32, MIT License, Copyright (c) 2022 Leon Sorokin.
  Inter variable font (Fontsource 5.3.0), SIL Open Font License 1.1,
  Copyright 2016 The Inter Project Authors.
-->
<style>{{FONT_CSS}}</style>
<style>{{UPLOT_CSS}}</style>
<style>{{REPORT_CSS}}</style>
</head>
<body>
<main class="wrap" id="report">
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span>SetVector <small>track report</small></div>
    <div class="seg" id="theme" role="group" aria-label="Color theme">
      <button type="button" data-theme="auto">Auto</button>
      <button type="button" data-theme="dark">Dark</button>
      <button type="button" data-theme="light">Light</button>
    </div>
  </header>

  <section class="hero">
    <div class="artist" id="artist"></div>
    <h1 id="title"></h1>
    <div class="meta" id="meta"></div>
  </section>

  <section class="stats" id="stats" aria-label="Summary"></section>

  <section class="card">
    <div class="player">
      <button type="button" class="play" id="play" aria-label="Play">
        <svg id="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>
        <svg id="icon-pause" viewBox="0 0 24 24" aria-hidden="true" hidden><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
      </button>
      <div class="overview-wrap">
        <div class="time">
          <span><b id="position">0:00</b> / <span id="duration">0:00</span></span>
          <span id="seek-hint">Click or drag on the track to jump there. Space plays and pauses.</span>
        </div>
        <canvas id="overview" aria-label="Whole-track overview"></canvas>
        <div class="legend">Bar height shows level, color shows bass <span class="ramp" aria-hidden="true"></span> less bass → more bass</div>
      </div>
    </div>
  </section>

  <section class="notice" id="warnings" hidden>
    <strong>Analysis warnings</strong>
    <ul id="warning-list"></ul>
  </section>

  <section class="card">
    <div class="card-head">
      <div><h2>Close-up</h2><div class="sub" id="window-label"></div></div>
      <div class="controls">
        <label class="toggle"><input type="checkbox" id="follow" checked> Follow playback</label>
        <div class="seg" id="zoom" role="group" aria-label="Close-up length"></div>
      </div>
    </div>
    <div id="lanes"></div>
  </section>

  <details class="about">
    <summary>About this analysis</summary>
    <div class="facts" id="facts"></div>
    <p class="note">Tempo is an estimate from librosa's beat tracker and can be reported for material without a clear pulse.
      Bar lines assume 4/4 and start at the first detected beat; downbeats are not detected yet.
      Level is RMS amplitude, not a LUFS loudness measurement.
      Hits are scaled to this track's strongest moment, so compare them within a track, not across tracks.</p>
    <p class="note">This page works offline. It embeds uPlot 1.6.32 (MIT License) and the Inter font (SIL Open Font License 1.1).</p>
  </details>
</main>
<script id="sv-model" type="application/json">{{MODEL_JSON}}</script>
<script id="sv-audio" type="application/octet-stream" data-mime="{{AUDIO_TYPE}}">{{AUDIO_DATA}}</script>
<script>{{UPLOT_JS}}</script>
<script>{{REPORT_JS}}</script>
</body>
</html>
```

- [ ] **Step 6: Create `src/setvector/visualization/assets/report.css`**

```css
:root {
  color-scheme: dark;
  --font: "SetVector Inter", system-ui, "Segoe UI", Roboto, sans-serif;
  --bg: #0e1015; --panel: #161a22; --panel-2: #1d222c; --line: #2a303c;
  --text: #eef1f6; --muted: #9aa3b2; --faint: #6b7382;
  --play: #ff5a5f; --warn: #ffb454;
  --level: #7c9cff; --bass: #ffb454; --bright: #c38bff; --hits: #4cd6a3;
  --radius: 14px;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f4f5f8; --panel: #ffffff; --panel-2: #eef0f4; --line: #dde1e8;
    --text: #151821; --muted: #5d6574; --faint: #8a92a0; --warn: #b86e00;
    --level: #3c5ce6; --bass: #d98200; --bright: #8e4fe0; --hits: #0f9f78;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f5f8; --panel: #ffffff; --panel-2: #eef0f4; --line: #dde1e8;
  --text: #151821; --muted: #5d6574; --faint: #8a92a0; --warn: #b86e00;
  --level: #3c5ce6; --bass: #d98200; --bright: #8e4fe0; --hits: #0f9f78;
}
[hidden] { display: none !important; }
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text); font-family: var(--font);
  font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 22px 24px 60px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: -0.01em; }
.brand small { color: var(--muted); font-weight: 500; }
.brand-mark { width: 22px; height: 22px; border-radius: 7px;
  background: conic-gradient(from 200deg, var(--level), var(--bright), var(--bass), var(--level)); }
.seg { display: inline-flex; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 3px; }
.seg button { font: inherit; font-size: 12.5px; border: 0; background: transparent; color: var(--muted);
  padding: 5px 11px; border-radius: 999px; cursor: pointer; }
.seg button.on { background: var(--panel-2); color: var(--text); }
.seg button:focus-visible, .play:focus-visible, .info:focus-visible { outline: 2px solid var(--level); outline-offset: 2px; }
.hero .artist { font-size: 16px; color: var(--muted); font-weight: 500; }
.hero h1 { font-size: 30px; line-height: 1.15; margin: 2px 0 4px; letter-spacing: -0.02em; font-weight: 700; overflow-wrap: anywhere; }
.hero .meta { margin-top: 8px; font-size: 13px; color: var(--faint); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0 16px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.stat .k { font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.stat .v { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin-top: 4px; }
.stat .v small { font-size: 14px; color: var(--muted); font-weight: 500; margin-left: 4px; }
.stat .hint { font-size: 12px; color: var(--faint); margin-top: 2px; }
.meter { height: 6px; border-radius: 3px; background: var(--panel-2); margin-top: 9px; overflow: hidden; }
.meter > div { height: 100%; border-radius: 3px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; margin-bottom: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.card-head h2 { font-size: 15px; margin: 0; font-weight: 600; }
.card-head .sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
.controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.player { display: flex; gap: 16px; align-items: center; }
.play { width: 54px; height: 54px; flex: none; border-radius: 50%; border: 0; background: var(--play); cursor: pointer;
  display: grid; place-items: center; box-shadow: 0 6px 18px rgba(255, 90, 95, .35); }
.play svg { width: 22px; height: 22px; fill: #fff; }
.overview-wrap { flex: 1; min-width: 0; }
.time { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: var(--muted); margin-bottom: 6px; }
.time b { color: var(--text); font-weight: 600; }
#overview { display: block; width: 100%; height: 84px; border-radius: 10px; cursor: pointer; touch-action: none; }
.legend { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--muted); margin-top: 8px; }
.legend .ramp { width: 90px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, #6f8cff, #b77cff, #ff7aa8, #ffb454); }
.notice { border: 1px solid var(--warn); border-radius: var(--radius); padding: 12px 16px; margin-bottom: 16px; font-size: 13px; }
.notice ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); }
.lane { display: grid; grid-template-columns: 150px minmax(0, 1fr) 88px; gap: 12px; align-items: center; padding: 6px 0; }
.lane + .lane { border-top: 1px solid var(--line); }
.lane .name { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
.lane .swatch { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.lane .desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
.lane .plot { min-width: 0; overflow: hidden; }
.lane .val { text-align: right; font-size: 15px; font-weight: 600; }
.lane .val small { display: block; font-size: 11.5px; color: var(--muted); font-weight: 500; }
.info { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 10.5px;
  font-style: normal; font-weight: 700; color: var(--muted); border: 1px solid var(--line); cursor: help; position: relative; }
.info:hover::after, .info:focus::after { content: attr(data-tip); position: absolute; left: 22px; top: -6px; width: 250px; z-index: 5;
  background: var(--panel-2); color: var(--text); border: 1px solid var(--line); padding: 8px 10px; border-radius: 9px;
  font-size: 12px; font-weight: 400; line-height: 1.45; box-shadow: 0 10px 30px rgba(0, 0, 0, .35); }
.toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); cursor: pointer; user-select: none; }
.toggle input { accent-color: var(--level); }
.u-cursor-x { border-right: 1px dashed var(--muted) !important; }
.about { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 18px; }
.about summary { cursor: pointer; font-weight: 600; font-size: 14px; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 20px; margin-top: 12px; font-size: 12.5px; }
.facts span { display: block; color: var(--muted); font-size: 11.5px; }
.facts div div { overflow-wrap: anywhere; }
.note { font-size: 12px; color: var(--muted); margin: 12px 0 0; line-height: 1.5; }
@media (max-width: 720px) {
  .wrap { padding: 16px 14px 40px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .facts { grid-template-columns: 1fr; }
  .lane { grid-template-columns: minmax(0, 1fr) 76px; }
  .lane .label { grid-column: 1 / -1; }
  .player { align-items: flex-start; }
  #seek-hint { display: none; }
}
```

- [ ] **Step 7: Create `src/setvector/visualization/assets/report.js`**

```javascript
/* SetVector track report: renders the embedded model and optional audio without network access. */
(() => {
  "use strict";

  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const model = JSON.parse($("sv-model").textContent);
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const mmss = (seconds) => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  };

  function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Arrays are little-endian, which matches the platforms browsers run on.
  const times = Array.from(new Float64Array(decodeBase64(model.timestamps).buffer));
  const values = {};
  for (const item of model.series) {
    const raw = new Float32Array(decodeBase64(item.values).buffer);
    values[item.name] = Array.from(raw, (v) => (Number.isNaN(v) ? null : v));
  }
  const lastTime = times.length ? times[times.length - 1] : 0;
  const duration = Math.max(model.duration_seconds, lastTime, 0.001);
  const hasTempo = model.tempo_bpm != null;
  const barLines = model.downbeats.length ? new Set(model.downbeats) : null;

  const LANES = [
    { key: "rms", label: "Level", hint: "How loud", color: "--level", unit: "RMS",
      tip: "Signal strength from moment to moment (RMS amplitude). Not a LUFS loudness measurement.",
      format: (v) => v.toFixed(2) },
    { key: "bass_power_ratio", label: "Bass", hint: "Low-end weight", color: "--bass", unit: "of power",
      tip: "Share of the sound's power at or below 250 Hz: kick and bassline weight.",
      format: (v) => `${Math.round(v * 100)}%` },
    { key: "spectral_centroid", label: "Brightness", hint: "Dark to bright", color: "--bright", unit: "kHz",
      tip: "Where the center of the frequency content sits (spectral centroid). Higher means brighter, such as hats and vocals.",
      format: (v) => (v / 1000).toFixed(1) },
    { key: "onset_strength", label: "Hits", hint: "Drums and attacks", color: "--hits", unit: "of peak",
      tip: "How sharply the sound changes: drums, plucks, and stabs. 100% is this track's strongest hit.",
      format: (v) => `${Math.round(v * 100)}%` },
  ];
  const ZOOMS = hasTempo
    ? [8, 16, 32, 64].map((bars) => ({ label: `${bars} bars`, seconds: (bars * 240) / model.tempo_bpm }))
    : [10, 20, 40, 80].map((seconds) => ({ label: `${seconds} s`, seconds }));

  const state = { position: 0, playing: false, hoverIndex: null, windowStart: 0, zoom: 1, follow: true };
  const windowLength = () => Math.min(ZOOMS[state.zoom].seconds, duration);

  function indexAt(time) {
    if (!times.length) return -1;
    let low = 0;
    let high = times.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle] < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  let palette = {};
  function readPalette() {
    const style = getComputedStyle(root);
    const read = (name) => style.getPropertyValue(name).trim();
    palette = {
      text: read("--text"), muted: read("--muted"), faint: read("--faint"), line: read("--line"),
      panel2: read("--panel-2"), font: read("--font"), lanes: LANES.map((lane) => read(lane.color)),
    };
  }

  function withAlpha(hex, alpha) {
    const match = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const n = parseInt(match[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // ---- static content ----
  function infoIcon(tip) {
    const icon = element("span", "info", "i");
    icon.dataset.tip = tip;
    icon.title = tip;
    icon.tabIndex = 0;
    return icon;
  }

  function statCard(label, value, unit, hint, tip, meter, color) {
    const card = element("div", "stat");
    const key = element("div", "k", label);
    if (tip) key.append(infoIcon(tip));
    const main = element("div", "v", value);
    if (unit) main.append(element("small", null, unit));
    card.append(key, main, element("div", "hint", hint));
    if (meter != null) {
      const bar = element("div", "meter");
      const fill = element("div");
      fill.style.width = `${clamp(meter, 0, 1) * 100}%`;
      fill.style.background = `var(${color})`;
      bar.append(fill);
      card.append(bar);
    }
    return card;
  }

  function renderStatic() {
    $("title").textContent = model.title;
    $("artist").textContent = model.artist || "";
    $("artist").hidden = !model.artist;
    const beatText = model.beats.length ? `${model.beats.length.toLocaleString()} beats detected` : "No beats detected";
    $("meta").textContent = `${model.format_line} · ${mmss(duration)} · ${beatText}`;
    $("duration").textContent = mmss(duration);

    const s = model.summary;
    $("stats").replaceChildren(
      statCard("Tempo", hasTempo ? String(Math.round(model.tempo_bpm)) : "—", hasTempo ? "BPM" : null,
        hasTempo ? "Estimated" : "Not detected", "Estimated from the beat pattern. Check it against your DJ software."),
      statCard("Length", mmss(duration), null,
        s.bar_estimate != null ? `≈ ${s.bar_estimate} bars at this tempo` : "Bars need a tempo estimate"),
      statCard("Bass", s.bass_band || "—", null,
        s.bass_median != null ? `${Math.round(s.bass_median * 100)}% of power below 250 Hz (median)` : "No signal",
        s.bass_tip, s.bass_median, "--bass"),
      statCard("Brightness", s.brightness_band || "—", null,
        s.centroid_median != null ? `Centered around ${(s.centroid_median / 1000).toFixed(1)} kHz (median)` : "No signal",
        s.brightness_tip, s.centroid_median != null ? s.centroid_median / 8000 : null, "--bright"),
    );

    if (model.warnings.length) {
      $("warnings").hidden = false;
      $("warning-list").replaceChildren(...model.warnings.map((text) => element("li", null, text)));
    }
    $("facts").replaceChildren(...model.facts.map(([label, value]) => {
      const item = element("div");
      item.append(element("span", null, label), element("div", null, value));
      return item;
    }));

    $("lanes").replaceChildren(...LANES.map((lane, index) => {
      const row = element("div", "lane");
      const label = element("div", "label");
      const name = element("div", "name");
      const swatch = element("i", "swatch");
      swatch.style.background = `var(${lane.color})`;
      name.append(swatch, document.createTextNode(lane.label), infoIcon(lane.tip));
      label.append(name, element("div", "desc", lane.hint));
      const plot = element("div", "plot");
      plot.id = `lane-plot-${index}`;
      const value = element("div", "val");
      value.id = `lane-value-${index}`;
      row.append(label, plot, value);
      return row;
    }));
  }

  function renderZoom() {
    $("zoom").replaceChildren(...ZOOMS.map((zoom, index) => {
      const button = element("button", index === state.zoom ? "on" : "", zoom.label);
      button.type = "button";
      button.addEventListener("click", () => {
        state.zoom = index;
        placeWindow(state.position);
        renderZoom();
        render();
      });
      return button;
    }));
  }

  // ---- audio ----
  const audioNode = $("sv-audio");
  const audioText = audioNode.textContent.trim();
  const audio = audioText
    ? new Audio(URL.createObjectURL(new Blob([decodeBase64(audioText)], { type: audioNode.dataset.mime || "audio/mpeg" })))
    : null;

  function placeWindow(anchor) {
    const length = windowLength();
    state.windowStart = clamp(anchor - length * 0.35, 0, Math.max(duration - length, 0));
  }

  function seek(time, moveWindow = true) {
    state.position = clamp(time, 0, duration);
    if (audio) audio.currentTime = state.position;
    if (moveWindow) placeWindow(state.position);
    render();
  }

  function togglePlay() {
    if (!audio) return;
    if (audio.paused) {
      audio.currentTime = state.position;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function tick() {
    if (!state.playing) return;
    state.position = audio.currentTime;
    if (state.follow) placeWindow(state.position);
    render();
    requestAnimationFrame(tick);
  }

  if (audio) {
    audio.preload = "auto";
    audio.addEventListener("play", () => { state.playing = true; requestAnimationFrame(tick); render(); });
    audio.addEventListener("pause", () => { state.playing = false; render(); });
    audio.addEventListener("ended", () => { state.playing = false; render(); });
  } else {
    $("play").hidden = true;
    $("seek-hint").textContent = "No audio embedded. Click the track to move the close-up.";
  }

  // ---- overview ----
  const overview = $("overview");
  const BASS_STOPS = [[111, 140, 255], [183, 124, 255], [255, 122, 168], [255, 180, 84]];
  let overviewBins = null;

  function computeBins(count) {
    const peaks = new Float32Array(count);
    const bassSum = new Float64Array(count);
    const bassCount = new Uint32Array(count);
    const level = values.rms || [];
    const bass = values.bass_power_ratio || [];
    for (let i = 0; i < times.length; i += 1) {
      const bin = Math.min(count - 1, Math.floor((times[i] / duration) * count));
      if (level[i] != null && level[i] > peaks[bin]) peaks[bin] = level[i];
      if (bass[i] != null) { bassSum[bin] += bass[i]; bassCount[bin] += 1; }
    }
    let top = 0;
    for (const peak of peaks) top = Math.max(top, peak);
    return { count, peaks, top, bass: Array.from(bassSum, (sum, i) => (bassCount[i] ? sum / bassCount[i] : null)) };
  }

  function bassColor(ratio) {
    if (ratio == null) return palette.faint;
    const x = clamp(ratio, 0, 1) * (BASS_STOPS.length - 1);
    const i = Math.min(Math.floor(x), BASS_STOPS.length - 2);
    const f = x - i;
    const rgb = BASS_STOPS[i].map((c, j) => Math.round(c + (BASS_STOPS[i + 1][j] - c) * f));
    return `rgb(${rgb.join(",")})`;
  }

  function drawOverview() {
    const ratio = window.devicePixelRatio || 1;
    const width = overview.clientWidth;
    const height = overview.clientHeight;
    if (!width || !height) return;
    if (overview.width !== Math.round(width * ratio) || overview.height !== Math.round(height * ratio)) {
      overview.width = Math.round(width * ratio);
      overview.height = Math.round(height * ratio);
    }
    const barWidth = 3;
    const gap = 1;
    const count = Math.max(1, Math.floor(width / (barWidth + gap)));
    if (!overviewBins || overviewBins.count !== count) overviewBins = computeBins(count);
    const ctx = overview.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.panel2;
    ctx.fillRect(0, 0, width, height);
    const middle = height / 2;
    const played = audio ? (state.position / duration) * width : width;
    const { peaks, bass, top } = overviewBins;
    for (let i = 0; i < count; i += 1) {
      const x = i * (barWidth + gap);
      const half = top > 0 ? Math.max(1, (peaks[i] / top) * (middle - 4)) : 1;
      ctx.globalAlpha = x + barWidth <= played ? 1 : 0.42;
      ctx.fillStyle = bassColor(bass[i]);
      ctx.fillRect(x, middle - half, barWidth, half * 2);
    }
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = palette.text;
    ctx.lineWidth = 1.5;
    const start = (state.windowStart / duration) * width;
    const end = ((state.windowStart + windowLength()) / duration) * width;
    ctx.strokeRect(start + 0.75, 1.5, Math.max(end - start - 1.5, 2), height - 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.text;
    ctx.fillRect((state.position / duration) * width - 1, 0, 2, height);
  }

  function scrubTo(event) {
    const box = overview.getBoundingClientRect();
    seek(((event.clientX - box.left) / box.width) * duration);
  }
  overview.addEventListener("pointerdown", (event) => { overview.setPointerCapture(event.pointerId); scrubTo(event); });
  overview.addEventListener("pointermove", (event) => { if (overview.hasPointerCapture(event.pointerId)) scrubTo(event); });

  // ---- close-up lanes ----
  const plots = [];

  function laneRange(key) {
    if (key === "bass_power_ratio" || key === "onset_strength") return [0, 1];
    let top = 0;
    for (const v of values[key]) if (v != null && v > top) top = v;
    return [0, top > 0 ? top * 1.08 : 1];
  }

  function drawBeats(u) {
    if (!model.beats.length) return;
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    const min = u.scales.x.min;
    const max = u.scales.x.max;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.strokeStyle = palette.line;
    model.beats.forEach((beat, index) => {
      if (beat < min || beat > max) return;
      const bar = barLines ? barLines.has(beat) : index % 4 === 0;
      ctx.globalAlpha = bar ? 1 : 0.45;
      ctx.lineWidth = (bar ? 1.4 : 1) * uPlot.pxRatio;
      const x = Math.round(u.valToPos(beat, "x", true)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawPlayhead(u) {
    if (state.position < u.scales.x.min || state.position > u.scales.x.max) return;
    const { ctx } = u;
    const x = u.valToPos(state.position, "x", true);
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.fillRect(x - uPlot.pxRatio, u.bbox.top, 2 * uPlot.pxRatio, u.bbox.height);
    ctx.restore();
  }

  function onCursor(u) {
    const hovering = u.cursor.left != null && u.cursor.left >= 0 && u.cursor.idx != null;
    state.hoverIndex = hovering ? u.cursor.idx : null;
    renderReadouts();
    renderWindowLabel();
  }

  function buildPlots() {
    readPalette();
    for (const plot of plots) plot.destroy();
    plots.length = 0;
    const range = [state.windowStart, state.windowStart + windowLength()];
    LANES.forEach((lane, index) => {
      const host = $(`lane-plot-${index}`);
      const color = palette.lanes[index];
      const withAxis = index === LANES.length - 1;
      const plot = new uPlot({
        width: Math.max(host.clientWidth, 50),
        height: withAxis ? 94 : 66,
        legend: { show: false },
        select: { show: false },
        cursor: {
          sync: { key: "setvector-report" },
          drag: { x: false, y: false, setScale: false },
          points: { show: false },
          y: false,
        },
        scales: {
          x: { time: false, auto: false, range },
          y: { auto: false, range: laneRange(lane.key) },
        },
        axes: [
          {
            show: withAxis, stroke: palette.faint, font: `11px ${palette.font}`, size: 28, gap: 4,
            grid: { show: false }, ticks: { show: false }, values: (u, splits) => splits.map(mmss),
          },
          { show: false },
        ],
        series: [
          {},
          {
            stroke: color,
            width: 1.6,
            points: { show: false },
            fill: (u) => {
              const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
              gradient.addColorStop(0, withAlpha(color, 0.34));
              gradient.addColorStop(1, withAlpha(color, 0.02));
              return gradient;
            },
          },
        ],
        hooks: { drawAxes: [drawBeats], draw: [drawPlayhead], setCursor: [onCursor] },
      }, [times, values[lane.key]], host);
      plot.over.addEventListener("click", (event) => seek(plot.posToVal(event.offsetX, "x"), false));
      plots.push(plot);
    });
  }

  function renderReadouts() {
    const index = state.hoverIndex != null ? state.hoverIndex : indexAt(state.position);
    LANES.forEach((lane, i) => {
      const value = index >= 0 ? values[lane.key][index] : null;
      $(`lane-value-${i}`).replaceChildren(
        document.createTextNode(value == null ? "—" : lane.format(value)),
        element("small", null, value == null ? "no signal" : lane.unit),
      );
    });
  }

  function renderWindowLabel() {
    const start = state.windowStart;
    const end = start + windowLength();
    const zoom = ZOOMS[state.zoom].label;
    const scale = hasTempo ? `${zoom} at ${Math.round(model.tempo_bpm)} BPM` : zoom;
    const at = state.hoverIndex != null ? `values at ${mmss(times[state.hoverIndex])}` : "values at the playhead";
    $("window-label").textContent = `${mmss(start)} – ${mmss(end)} · ${scale} · ${at}`;
  }

  function render() {
    $("position").textContent = mmss(state.position);
    $("icon-play").hidden = state.playing;
    $("icon-pause").hidden = !state.playing;
    $("play").setAttribute("aria-label", state.playing ? "Pause" : "Play");
    drawOverview();
    const min = state.windowStart;
    const max = min + windowLength();
    for (const plot of plots) {
      if (plot.scales.x.min !== min || plot.scales.x.max !== max) plot.setScale("x", { min, max });
      else plot.redraw(false, false);
    }
    renderWindowLabel();
    renderReadouts();
  }

  // ---- theme ----
  const THEME_KEY = "setvector-report-theme";
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; }
  }
  function applyTheme(choice, save) {
    if (choice === "auto") delete root.dataset.theme;
    else root.dataset.theme = choice;
    if (save) {
      try { localStorage.setItem(THEME_KEY, choice); } catch { /* storage unavailable */ }
    }
    $("theme").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.theme === choice));
    buildPlots();
    render();
  }

  // ---- wiring ----
  renderStatic();
  renderZoom();
  placeWindow(0);
  $("play").addEventListener("click", togglePlay);
  $("follow").addEventListener("change", (event) => {
    state.follow = event.target.checked;
    if (state.follow) placeWindow(state.position);
    render();
  });
  $("theme").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.theme, true));
  });
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !audio) return;
    if (event.target.closest && event.target.closest("button, input, select, textarea, summary")) return;
    event.preventDefault();
    togglePlay();
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!root.dataset.theme) { buildPlots(); render(); }
  });
  let resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      plots.forEach((plot, i) => plot.setSize({ width: Math.max($(`lane-plot-${i}`).clientWidth, 50), height: plot.height }));
      overviewBins = null;
      render();
    }, 60);
  }).observe($("report"));
  applyTheme(storedTheme(), false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { buildPlots(); render(); });
})();
```

- [ ] **Step 8: Run the renderer and asset tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_visualization_html.py tests/test_visualization_assets.py tests/test_visualization_model.py -q`

Expected: PASS. The Node syntax test passes when Node is installed and is skipped otherwise.

- [ ] **Step 9: Render a sample page and inspect it in a browser**

```bash
.venv/Scripts/python.exe - <<'EOF'
from pathlib import Path
import tempfile
from setvector.storage import ArtifactStore
from setvector.visualization import build_report_model, render_report_html
store = ArtifactStore("<an analysis workspace from a real track>")
asset, bundle = store.load_stored("<feature id>")
target = Path(tempfile.gettempdir()) / "setvector-sample-report.html"
target.write_text(render_report_html(build_report_model(asset, bundle)), encoding="utf-8")
print(target)
EOF
```

Open the printed file. Expected: header, stat cards, overview, four lanes with beat lines, working zoom, hover values, and theme toggle; the browser console shows no errors.

- [ ] **Step 10: Lint and commit**

```bash
git add src/setvector/visualization tests/test_visualization_html.py tests/test_visualization_assets.py
git commit -m "feat(report): render self-contained interactive report pages"
```

---

### Task 6: Report service and CLI command

**Files:**
- Create: `src/setvector/application/report.py`
- Modify: `src/setvector/application/__init__.py`
- Modify: `src/setvector/cli/__init__.py`
- Create: `tests/test_application_report.py`
- Modify: `tests/test_cli.py`

- [ ] **Step 1: Write failing service tests in `tests/test_application_report.py`**

```python
"""Report generation reuses stored features and verifies embedded audio."""

import base64
import re
import shutil

import pytest

from setvector.application import ReportOutcome, analyze_track, render_report
from setvector.domain import InputError
from setvector.storage import ArtifactStore


def unexpected(*args, **kwargs):
    raise AssertionError("report generation must not reanalyze audio")


@pytest.fixture
def analyzed(tmp_path, tone_path, config):
    store = ArtifactStore(tmp_path / "workspace")
    return store, analyze_track(tone_path, config, store)


def embedded_audio(path):
    html = path.read_text(encoding="utf-8")
    match = re.search(r'<script id="sv-audio"[^>]*>(.*?)</script>', html, re.S)
    return base64.b64decode(match.group(1))


def test_default_report_embeds_verified_audio(monkeypatch, analyzed):
    store, outcome = analyzed
    monkeypatch.setattr("setvector.application.analyze.decode_audio", unexpected)
    monkeypatch.setattr("setvector.application.analyze.extract_baseline", unexpected)
    result = render_report(outcome.features.feature_id, store)
    assert isinstance(result, ReportOutcome)
    assert result.report_path == store.workspace / "reports" / f"{outcome.features.feature_id}.html"
    assert result.audio_embedded
    assert embedded_audio(result.report_path)[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xe3", b"ID")


def test_no_audio_and_custom_output(tmp_path, analyzed):
    store, outcome = analyzed
    result = render_report(
        outcome.features.feature_id, store, output=tmp_path / "out" / "r.html", include_audio=False
    )
    assert result.report_path == (tmp_path / "out" / "r.html").resolve()
    assert not result.audio_embedded
    assert embedded_audio(result.report_path) == b""


def test_moved_audio_needs_an_explicit_path(tmp_path, analyzed, tone_path):
    store, outcome = analyzed
    moved = tmp_path / "moved.wav"
    shutil.move(tone_path, moved)
    with pytest.raises(InputError, match="--no-audio"):
        render_report(outcome.features.feature_id, store)
    assert render_report(outcome.features.feature_id, store, audio=moved).audio_embedded


def test_different_audio_is_refused(tmp_path, analyzed, click_tone_writer):
    store, outcome = analyzed
    other = click_tone_writer(tmp_path / "other.wav", tone_hz=330.0)
    with pytest.raises(InputError, match="not the audio that was analyzed"):
        render_report(outcome.features.feature_id, store, audio=other)


def test_existing_report_requires_overwrite(analyzed):
    store, outcome = analyzed
    feature_id = outcome.features.feature_id
    first = render_report(feature_id, store, include_audio=False)
    with pytest.raises(InputError, match="--overwrite"):
        render_report(feature_id, store, include_audio=False)
    assert render_report(feature_id, store, include_audio=False, overwrite=True) == first


def test_audio_path_and_no_audio_conflict(analyzed, tone_path):
    store, outcome = analyzed
    with pytest.raises(InputError, match="either"):
        render_report(outcome.features.feature_id, store, audio=tone_path, include_audio=False)


def test_unknown_feature_is_an_input_error(tmp_path):
    with pytest.raises(InputError, match="no feature artifact"):
        render_report("f" * 64, ArtifactStore(tmp_path))
```

- [ ] **Step 2: Add failing CLI tests to `tests/test_cli.py`**

Change the unimplemented-command parametrization to `["score", "compare"]`, add `render_report`-related imports only through `cli`, and append:

```python
def analyze_for_report(tmp_path, tone_path, config_path):
    result = run_cli(
        "analyze", str(tone_path), "--config", str(config_path), "--workspace", "ws", cwd=tmp_path
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["feature_id"]


def test_report_cli_writes_self_contained_page(tmp_path, tone_path, config_path):
    feature_id = analyze_for_report(tmp_path, tone_path, config_path)
    result = run_cli("report", feature_id, "--workspace", "ws", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output == {
        "audio": "embedded",
        "feature_id": feature_id,
        "report_path": str((tmp_path / "ws" / "reports" / f"{feature_id}.html").resolve()),
    }
    assert Path(output["report_path"]).read_text(encoding="utf-8").startswith("<!DOCTYPE html>")

    again = run_cli("report", feature_id, "--workspace", "ws", cwd=tmp_path)
    assert again.returncode == 2
    assert "--overwrite" in again.stderr
    replaced = run_cli(
        "report", feature_id, "--workspace", "ws", "--overwrite", "--no-audio", cwd=tmp_path
    )
    assert replaced.returncode == 0, replaced.stderr
    assert json.loads(replaced.stdout)["audio"] == "none"


@pytest.mark.parametrize(
    "arguments, message",
    [
        (["f" * 64, "--workspace", "ws"], "no feature artifact"),
        (["bad-id", "--workspace", "ws"], "invalid feature ID"),
        (["f" * 64, "--workspace", "ws", "--audio", "x.wav", "--no-audio"], "not allowed with"),
    ],
)
def test_report_cli_input_errors(tmp_path, arguments, message):
    result = run_cli("report", *arguments, cwd=tmp_path)
    assert result.returncode == 2
    assert message in result.stderr
    assert result.stdout == ""
    assert "Traceback" not in result.stderr


def test_report_cli_processing_failure_exits_1(monkeypatch, capsys, tmp_path):
    def failing(*args, **kwargs):
        raise ArtifactError("stored artifact is corrupt")

    monkeypatch.setattr(cli, "render_report", failing)
    code = cli.main(["report", "f" * 64, "--workspace", str(tmp_path)])
    assert code == 1
    assert capsys.readouterr().err.strip() == "setvector: error: stored artifact is corrupt"
```

- [ ] **Step 3: Run and confirm failure**

Run: `.venv/Scripts/python.exe -m pytest tests/test_application_report.py tests/test_cli.py -q`

Expected: FAIL because `render_report` and the `report` command do not exist.

- [ ] **Step 4: Implement `src/setvector/application/report.py`**

```python
"""Render a stored feature artifact as a self-contained HTML report."""

from dataclasses import dataclass
from pathlib import Path

from setvector.domain import InputError
from setvector.ingestion import load_preview
from setvector.storage import ArtifactStore, write_report
from setvector.visualization import build_report_model, render_report_html


@dataclass(frozen=True, slots=True)
class ReportOutcome:
    """Where the report was written and whether it carries audio."""

    report_path: Path
    feature_id: str
    audio_embedded: bool


def render_report(
    feature_id: str,
    store: ArtifactStore,
    *,
    output: str | Path | None = None,
    audio: str | Path | None = None,
    include_audio: bool = True,
    overwrite: bool = False,
) -> ReportOutcome:
    """Build a report from stored features without reanalyzing audio.

    Audio comes from ``audio`` or the path recorded at analysis time and must hash to
    the analyzed asset. The default output is ``<workspace>/reports/<feature-id>.html``.
    """
    if audio is not None and not include_audio:
        raise InputError("choose either an audio path or no audio, not both")
    asset, bundle = store.load_stored(feature_id)
    preview = None
    if include_audio:
        source = Path(audio) if audio is not None else Path(asset.observed_path)
        try:
            preview = load_preview(source, asset)
        except InputError as error:
            raise InputError(
                f"{error}. Pass --audio <path> to the analyzed file, or --no-audio."
            ) from error
    html = render_report_html(build_report_model(asset, bundle), preview)
    target = (
        Path(output) if output is not None else store.workspace / "reports" / f"{feature_id}.html"
    )
    path = write_report(target, html, overwrite=overwrite)
    return ReportOutcome(path, bundle.feature_id, preview is not None)
```

Update `src/setvector/application/__init__.py`:

```python
"""Workflows shared by the CLI and Python callers."""

from .analyze import AnalysisOutcome, analyze_track
from .report import ReportOutcome, render_report

__all__ = ["AnalysisOutcome", "ReportOutcome", "analyze_track", "render_report"]
```

- [ ] **Step 5: Add the CLI command with shared error mapping**

In `src/setvector/cli/__init__.py`, change the application import to `from setvector.application import analyze_track, render_report`, and replace `_run_analyze` with:

```python
def _call(args: argparse.Namespace, action):
    """Run a service call, returning ``(result, None)`` or ``(None, exit_status)``."""
    try:
        return action(), None
    except InputError as error:
        args.parser.error(str(error))
    except SetVectorError as error:
        print(f"setvector: error: {error}", file=sys.stderr)
        return None, 1
    except KeyboardInterrupt:
        print("setvector: interrupted; completed artifacts were kept", file=sys.stderr)
        return None, 130


def _run_analyze(args: argparse.Namespace) -> int:
    try:
        config = _load_config(args.config)
    except (OSError, ValueError, TypeError) as error:
        args.parser.error(f"cannot load configuration {args.config}: {error}")
    outcome, status = _call(
        args, lambda: analyze_track(args.audio, config, ArtifactStore(args.workspace))
    )
    if status is not None:
        return status
    result = {
        "asset_id": outcome.asset.asset_id,
        "feature_id": outcome.features.feature_id,
        "cache_hit": outcome.cache_hit,
        "manifest_path": str(outcome.manifest_path),
    }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    for warning in outcome.features.measurements.diagnostics.warnings:
        print(f"setvector: warning: {warning}", file=sys.stderr)
    return 0


def _run_report(args: argparse.Namespace) -> int:
    outcome, status = _call(
        args,
        lambda: render_report(
            args.feature_id,
            ArtifactStore(args.workspace),
            output=args.output,
            audio=args.audio,
            include_audio=not args.no_audio,
            overwrite=args.overwrite,
        ),
    )
    if status is not None:
        return status
    result = {
        "audio": "embedded" if outcome.audio_embedded else "none",
        "feature_id": outcome.feature_id,
        "report_path": str(outcome.report_path),
    }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0
```

In `_build_parser`, before `return parser`, add:

```python
def _build_parser() -> argparse.ArgumentParser:  # existing function; add before `return parser`
    report_parser = commands.add_parser(
        "report",
        help="Render an interactive HTML report from analyzed features",
        description="Render stored features as a self-contained HTML page that works offline.",
    )
    report_parser.add_argument("feature_id", help="Feature ID printed by analyze")
    report_parser.add_argument(
        "--workspace", type=Path, required=True, help="Directory holding analysis artifacts"
    )
    report_parser.add_argument(
        "--output",
        type=Path,
        help="HTML file to write (default: <workspace>/reports/<feature-id>.html)",
    )
    audio_options = report_parser.add_mutually_exclusive_group()
    audio_options.add_argument(
        "--audio", type=Path, help="Current path of the analyzed audio file, if it moved"
    )
    audio_options.add_argument(
        "--no-audio", action="store_true", help="Build the report without a player"
    )
    report_parser.add_argument(
        "--overwrite", action="store_true", help="Replace an existing report file"
    )
    report_parser.set_defaults(handler=_run_report, parser=report_parser)
```

- [ ] **Step 6: Run the service and CLI tests, then the full suite**

Run: `.venv/Scripts/python.exe -m pytest tests/test_application_report.py tests/test_cli.py -q`

Expected: PASS.

Run: `.venv/Scripts/python.exe -m pytest -q`

Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
git add src/setvector/application src/setvector/cli tests/test_application_report.py tests/test_cli.py
git commit -m "feat(cli): add the report command"
```

---

### Task 7: Offline verification, documentation, and release checks

**Files:**
- Modify: `tests/test_offline_analysis.py`
- Modify: `README.md`, `docs/development.md`, `docs/architecture.md`, `docs/implementation-plan.md`

- [ ] **Step 1: Extend the offline test to render a report**

Append to `test_analyze_and_cache_work_with_network_sockets_blocked`:

```python
    feature_id = json.loads(first.stdout)["feature_id"]
    report = subprocess.run(
        [sys.executable, "-m", "setvector", "report", feature_id, "--workspace", str(workspace)],
        cwd=tmp_path,
        env=offline_environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert report.returncode == 0, report.stderr
    assert json.loads(report.stdout)["audio"] == "embedded"
    assert "network access attempted" not in report.stderr
```

Run: `.venv/Scripts/python.exe -m pytest tests/test_offline_analysis.py -q`

Expected: PASS.

- [ ] **Step 2: Update the documentation**

- `docs/architecture.md`: in the Python stack table, replace the Reports row with ``| Reports | Inlined uPlot plus custom canvas code | A small self-contained page (about 1 MB plus audio) with the approved scrubber, bar-based zoom, and audio sync; vendored assets keep reports offline |``, and replace the sentence citing Plotly's standalone HTML export with one citing uPlot's documentation (`https://github.com/leeoniya/uPlot`). In the offline section, keep "Interactive reports must embed their JavaScript".
- `README.md`: after the `analyze` example add

  ```powershell
  .\.venv\Scripts\setvector.exe report <feature-id> --workspace .setvector
  ```

  and one sentence: the report is a single HTML file with the track embedded, so treat it like the music file when sharing.
- `docs/development.md`: add a "Report" section after "Analyze audio" covering the command options, default output path, the JSON fields `audio`, `feature_id`, and `report_path`, audio verification and MP3 conversion, `--no-audio`, the `--overwrite` rule, exit codes, the offline guarantee, report size, the bundled uPlot and Inter licenses, and the sharing note.
- `docs/implementation-plan.md`: under step 3, add "Implemented as `setvector report`, a self-contained page with an embedded player, overview, and four synchronized feature lanes. Energy scoring and downbeat detection are not part of this step."

- [ ] **Step 3: Run the complete verification**

Run: `.venv/Scripts/python.exe -m pytest -q && .venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m ruff format --check .`

Expected: all pass.

- [ ] **Step 4: Build and inspect the wheel**

Run: `rm -rf dist && .venv/Scripts/python.exe -m build --no-isolation`

Run:

```bash
.venv/Scripts/python.exe -c "import zipfile, pathlib; w=next(pathlib.Path('dist').glob('*.whl')); n=zipfile.ZipFile(w).namelist(); need=['report.html','report.css','report.js','uPlot.iife.min.js','uPlot.min.css','inter-latin-wght-normal.woff2','inter-latin-ext-wght-normal.woff2','LICENSES/uPlot-LICENSE.txt','LICENSES/Inter-OFL.txt']; missing=[x for x in need if not any(p.endswith('visualization/assets/'+x) for p in n)]; assert not missing, missing; print(w)"
```

Expected: prints the wheel path.

- [ ] **Step 5: Manual check with a real track and silence, network disabled**

Install the wheel into a clean environment outside the checkout, analyze and report one real MP3 and one silent 5-second WAV with sockets blocked (same `sitecustomize.py` blocker as the offline test), then disconnect networking and open both reports. Expected: the real-track report plays audio, the playhead, overview, and lanes move together, zoom and hover work, and both themes render with Inter; the silent report shows "no signal" lanes, "—" stat values, and no errors in the browser console.

- [ ] **Step 6: Commit**

```bash
git add tests/test_offline_analysis.py README.md docs
git commit -m "docs(report): document offline interactive reports"
```
