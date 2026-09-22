"""Atomic, validated feature artifacts in a local workspace.

Layout::

    <workspace>/assets/<asset-id>/asset.json
    <workspace>/features/<feature-id>/manifest.json
    <workspace>/features/<feature-id>/arrays.npz

Artifacts are written into a temporary sibling directory, validated by reading
them back, and published with a single directory rename. A published directory
that is incomplete, corrupt, or inconsistent raises ``ArtifactError`` and is
never overwritten.
"""

import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path

import numpy as np

from setvector.domain import ArtifactError, AudioAsset, FeatureBundle
from setvector.domain._validation import require_fields, validate_version
from setvector.domain.audio import validate_sha256

from .canonical import compute_feature_id, strict_json_loads

_MANIFEST = "manifest.json"
_ARRAYS = "arrays.npz"
_ASSET = "asset.json"
_SERIES = ("rms", "spectral_centroid", "bass_power_ratio", "onset_strength")
_ARRAY_FIELDS = ("timestamps", "values", "validity", "window_starts", "window_ends")
_MANIFEST_FIELDS = {
    "schema_version",
    "feature_id",
    "asset_id",
    "config_id",
    "extractor",
    "bundle_schema_version",
    "tempo_bpm",
    "beats",
    "diagnostics",
    "series",
}
_SERIES_FIELDS = {"name", "unit", "schema_version", "arrays"}


def _array_key(series: str, field: str) -> str:
    return f"{series}__{field}"


def _asset_identity(asset: AudioAsset) -> dict[str, object]:
    return {key: value for key, value in asset.to_dict().items() if key != "observed_path"}


def _write_bytes(path: Path, data: bytes) -> None:
    with path.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _write_json(path: Path, value: Mapping[str, object]) -> None:
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    _write_bytes(path, (text + "\n").encode("utf-8"))


def _read_json(path: Path) -> object:
    return strict_json_loads(path.read_text(encoding="utf-8"))


def _encode_bundle(bundle: FeatureBundle) -> tuple[dict[str, object], dict[str, np.ndarray]]:
    measurements = bundle.measurements
    manifest: dict[str, object] = {
        "schema_version": 1,
        "feature_id": bundle.feature_id,
        "asset_id": bundle.asset_id,
        "config_id": bundle.config_id,
        "extractor": bundle.extractor.to_dict(),
        "bundle_schema_version": bundle.schema_version,
        "tempo_bpm": measurements.tempo_bpm,
        "beats": [beat.to_dict() for beat in measurements.beats],
        "diagnostics": measurements.diagnostics.to_dict(),
        "series": {},
    }
    arrays: dict[str, np.ndarray] = {}
    for name in _SERIES:
        series = getattr(measurements, name)
        manifest["series"][name] = {
            "name": series.name,
            "unit": series.unit,
            "schema_version": series.schema_version,
            "arrays": {field: _array_key(name, field) for field in _ARRAY_FIELDS},
        }
        # Invalid observations persist as 0.0; the validity mask restores None.
        values = [0.0 if value is None else value for value in series.values]
        arrays[_array_key(name, "values")] = np.asarray(values, dtype=np.float64)
        arrays[_array_key(name, "validity")] = np.asarray(series.validity, dtype=np.bool_)
        for field in ("timestamps", "window_starts", "window_ends"):
            arrays[_array_key(name, field)] = np.asarray(getattr(series, field), np.float64)
    return manifest, arrays


def _decode_array(arrays: Mapping[str, np.ndarray], key: str, kind: str) -> list[object]:
    array = arrays[key]
    if array.ndim != 1 or array.dtype.kind != kind:
        raise ValueError(f"array {key} must be one-dimensional with dtype kind {kind!r}")
    return array.tolist()


def _decode_bundle(manifest: object, arrays: Mapping[str, np.ndarray]) -> FeatureBundle:
    require_fields(manifest, _MANIFEST_FIELDS)
    validate_version(manifest["schema_version"])
    series_entries = manifest["series"]
    require_fields(series_entries, set(_SERIES))
    expected_keys = {_array_key(name, field) for name in _SERIES for field in _ARRAY_FIELDS}
    if set(arrays) != expected_keys:
        raise ValueError("arrays.npz does not contain exactly the expected series arrays")
    measurements: dict[str, object] = {
        "tempo_bpm": manifest["tempo_bpm"],
        "beats": manifest["beats"],
        "diagnostics": manifest["diagnostics"],
    }
    for name in _SERIES:
        entry = series_entries[name]
        require_fields(entry, _SERIES_FIELDS)
        references = entry["arrays"]
        expected_references = {field: _array_key(name, field) for field in _ARRAY_FIELDS}
        if references != expected_references:
            raise ValueError(f"series {name} references unexpected array keys")
        values = _decode_array(arrays, references["values"], "f")
        validity = _decode_array(arrays, references["validity"], "b")
        if len(values) != len(validity):
            raise ValueError(f"series {name} values and validity lengths differ")
        measurements[name] = {
            "schema_version": entry["schema_version"],
            "name": entry["name"],
            "unit": entry["unit"],
            "values": [v if ok else None for v, ok in zip(values, validity, strict=True)],
            "validity": validity,
            **{
                field: _decode_array(arrays, references[field], "f")
                for field in ("timestamps", "window_starts", "window_ends")
            },
        }
    return FeatureBundle.from_dict(
        {
            "feature_id": manifest["feature_id"],
            "asset_id": manifest["asset_id"],
            "config_id": manifest["config_id"],
            "extractor": manifest["extractor"],
            "measurements": measurements,
            "schema_version": manifest["bundle_schema_version"],
        }
    )


def _read_feature_directory(directory: Path, feature_id: str) -> FeatureBundle:
    manifest_path, arrays_path = directory / _MANIFEST, directory / _ARRAYS
    if not directory.is_dir() or not manifest_path.is_file() or not arrays_path.is_file():
        raise ArtifactError(f"feature artifact {feature_id} is incomplete: {directory}")
    try:
        manifest = _read_json(manifest_path)
        with np.load(arrays_path, allow_pickle=False) as npz:
            arrays = {key: npz[key] for key in npz.files}
        bundle = _decode_bundle(manifest, arrays)
        if bundle.feature_id != feature_id:
            raise ValueError("manifest feature_id does not match its directory")
        if compute_feature_id(bundle.asset_id, bundle.extractor) != feature_id:
            raise ValueError("feature_id does not match the recorded asset and extractor")
    except (OSError, ValueError, TypeError, KeyError) as error:
        raise ArtifactError(
            f"feature artifact {feature_id} is corrupt or incompatible: {error}"
        ) from error
    return bundle


def _check_bundle(asset: AudioAsset, bundle: FeatureBundle) -> None:
    if bundle.asset_id != asset.asset_id:
        raise ArtifactError("bundle asset_id does not match the audio asset")
    if bundle.feature_id != compute_feature_id(bundle.asset_id, bundle.extractor):
        raise ArtifactError("bundle feature_id does not match its asset and extractor identity")


class ArtifactStore:
    """Save and load content-addressed feature artifacts under one workspace."""

    def __init__(self, workspace: str | Path) -> None:
        self.workspace = Path(workspace).resolve()

    def manifest_path(self, feature_id: str) -> Path:
        """Return the absolute manifest location for ``feature_id``."""
        return self._feature_directory(feature_id) / _MANIFEST

    def load(self, feature_id: str, expected_asset: AudioAsset) -> FeatureBundle | None:
        """Return a valid cached bundle, ``None`` when absent, or raise ``ArtifactError``."""
        directory = self._feature_directory(feature_id)
        if not directory.exists():
            return None
        bundle = _read_feature_directory(directory, feature_id)
        _check_bundle(expected_asset, bundle)
        self._check_asset(expected_asset)
        return bundle

    def save(self, asset: AudioAsset, bundle: FeatureBundle) -> Path:
        """Publish ``bundle`` atomically, or accept an identical existing artifact."""
        _check_bundle(asset, bundle)
        self._publish_asset(asset)
        target = self._feature_directory(bundle.feature_id)
        if target.exists():
            return self._accept_existing(asset, bundle)
        manifest, arrays = _encode_bundle(bundle)

        def write(directory: Path) -> None:
            _write_json(directory / _MANIFEST, manifest)
            with (directory / _ARRAYS).open("wb") as stream:
                np.savez_compressed(stream, **arrays)
                stream.flush()
                os.fsync(stream.fileno())
            if _read_feature_directory(directory, bundle.feature_id) != bundle:
                raise ArtifactError(f"feature artifact {bundle.feature_id} failed verification")

        if not self._publish(target, write):
            return self._accept_existing(asset, bundle)
        return target / _MANIFEST

    def _feature_directory(self, feature_id: str) -> Path:
        return self.workspace / "features" / validate_sha256(feature_id, "feature_id")

    def _asset_path(self, asset_id: str) -> Path:
        return self.workspace / "assets" / validate_sha256(asset_id, "asset_id") / _ASSET

    def _check_asset(self, expected: AudioAsset) -> None:
        path = self._asset_path(expected.asset_id)
        if not path.is_file():
            raise ArtifactError(f"asset metadata is missing for {expected.asset_id}: {path}")
        try:
            stored = AudioAsset.from_dict(_read_json(path))
        except (OSError, ValueError, TypeError) as error:
            raise ArtifactError(
                f"asset metadata for {expected.asset_id} is corrupt or incompatible: {error}"
            ) from error
        if _asset_identity(stored) != _asset_identity(expected):
            raise ArtifactError(
                f"asset metadata for {expected.asset_id} does not match the inspected audio"
            )

    def _publish_asset(self, asset: AudioAsset) -> None:
        directory = self._asset_path(asset.asset_id).parent
        if directory.exists():
            self._check_asset(asset)
            return

        def write(temporary: Path) -> None:
            _write_json(temporary / _ASSET, asset.to_dict())
            if AudioAsset.from_dict(_read_json(temporary / _ASSET)) != asset:
                raise ArtifactError(f"asset metadata for {asset.asset_id} failed verification")

        if not self._publish(directory, write):
            self._check_asset(asset)

    def _publish(self, target: Path, write) -> bool:
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

    def _accept_existing(self, asset: AudioAsset, bundle: FeatureBundle) -> Path:
        existing = self.load(bundle.feature_id, asset)
        if existing != bundle:
            raise ArtifactError(
                f"existing feature artifact {bundle.feature_id} differs from the new results"
            )
        return self.manifest_path(bundle.feature_id)
