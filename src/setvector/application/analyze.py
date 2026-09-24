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
