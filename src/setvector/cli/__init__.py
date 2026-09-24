"""Command-line interface for SetVector."""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from setvector import AnalysisConfig, __version__
from setvector.application import analyze_track, render_report
from setvector.domain import InputError, SetVectorError
from setvector.storage import ArtifactStore, strict_json_loads


def _load_config(path: Path) -> AnalysisConfig:
    return AnalysisConfig.from_dict(strict_json_loads(path.read_text(encoding="utf-8-sig")))


def _run_config_validate(args: argparse.Namespace) -> int:
    try:
        config = _load_config(args.path)
    except (OSError, ValueError, TypeError) as error:
        args.parser.error(f"cannot validate {args.path}: {error}")
    print(json.dumps({"config_id": config.config_id, "config": config.to_dict()}, sort_keys=True))
    return 0


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
        print("setvector: interrupted", file=sys.stderr)
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


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="setvector",
        description="Tools for track analysis and energy-aware DJ set planning.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    commands = parser.add_subparsers(dest="command")

    config_parser = commands.add_parser("config", help="Work with analysis configurations")
    config_commands = config_parser.add_subparsers(dest="config_command", required=True)
    validate_parser = config_commands.add_parser("validate", help="Validate an analysis JSON file")
    validate_parser.add_argument("path", type=Path, help="Path to the configuration file")
    validate_parser.set_defaults(handler=_run_config_validate, parser=validate_parser)

    analyze_parser = commands.add_parser(
        "analyze",
        help="Extract baseline features and a beat grid from a local audio file",
        description="Extract baseline features locally and print their identifiers as JSON.",
    )
    analyze_parser.add_argument("audio", type=Path, help="Path to the audio file")
    analyze_parser.add_argument(
        "--config", type=Path, required=True, help="Analysis configuration JSON file"
    )
    analyze_parser.add_argument(
        "--workspace", type=Path, required=True, help="Directory for analysis artifacts"
    )
    analyze_parser.set_defaults(handler=_run_analyze, parser=analyze_parser)

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
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Parse arguments and run a command, returning its exit status."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    return args.handler(args)
