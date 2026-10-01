"""Workflows shared by the CLI and Python callers."""

from .analyze import AnalysisOutcome, analyze_track
from .rekordbox import (
    RekordboxExportOutcome,
    build_rekordbox_import,
    inspect_library,
    load_cue_requests,
)
from .report import ReportOutcome, render_report
from .report_index import ReportIndexOutcome, create_report_index

__all__ = [
    "AnalysisOutcome",
    "RekordboxExportOutcome",
    "ReportIndexOutcome",
    "ReportOutcome",
    "analyze_track",
    "build_rekordbox_import",
    "create_report_index",
    "inspect_library",
    "load_cue_requests",
    "render_report",
]
