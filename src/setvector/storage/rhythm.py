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
