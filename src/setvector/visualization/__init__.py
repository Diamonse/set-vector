"""Self-contained HTML reports built from stored feature artifacts."""

from .html import render_report_html
from .model import ReportModel, build_report_model

__all__ = ["ReportModel", "build_report_model", "render_report_html"]
