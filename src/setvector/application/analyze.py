"""Analyze one local track, reusing a stored feature artifact when possible."""

from dataclasses import dataclass
from pathlib import Path

from setvector.analysis import baseline_identity, extract_baseline
from setvector.domain import AnalysisConfig, AudioAsset, FeatureBundle
from setvector.ingestion import decode_audio, inspect_audio
from setvector.storage import ArtifactStore, compute_feature_id


@dataclass(frozen=True, slots=True)
class AnalysisOutcome:
    """The analyzed asset, its features, where they are stored, and cache reuse."""

    asset: AudioAsset
    features: FeatureBundle
    manifest_path: Path
    cache_hit: bool


def analyze_track(
    path: str | Path, config: AnalysisConfig, store: ArtifactStore
) -> AnalysisOutcome:
    """Inspect, then either load cached features or decode, extract, and save them.

    The feature identity is computed from content and environment before decoding,
    so an intact cached artifact is returned without decoding the audio again.
    """
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
