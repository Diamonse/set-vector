"""Render a stored feature artifact as a self-contained HTML report."""

from dataclasses import dataclass
from pathlib import Path

from setvector.analysis import rhythm_identity
from setvector.domain import InputError
from setvector.ingestion import load_preview
from setvector.storage import ArtifactStore, RhythmStore, compute_rhythm_id, write_report
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
    rhythm_id = compute_rhythm_id(bundle.feature_id, rhythm_identity(bundle.extractor))
    rhythm = RhythmStore(store.workspace).load(rhythm_id)
    target = (
        Path(output) if output is not None else store.workspace / "reports" / f"{feature_id}.html"
    )
    resolved_target = target.resolve()
    if resolved_target.exists() and not overwrite:
        raise InputError(
            f"report already exists: {resolved_target}; pass --overwrite to replace it"
        )
    preview = None
    if include_audio:
        source = Path(audio) if audio is not None else Path(asset.observed_path)
        try:
            preview = load_preview(source, asset)
        except InputError as error:
            raise InputError(
                f"{error}. Pass --audio <path> to the analyzed file, or --no-audio."
            ) from error
    html = render_report_html(build_report_model(asset, bundle, rhythm), preview)
    path = write_report(target, html, overwrite=overwrite)
    return ReportOutcome(path, bundle.feature_id, preview is not None)
