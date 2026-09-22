"""Command-line interface for SetVector."""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from setvector import AnalysisConfig, __version__
from setvector.application import analyze_track
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


def _run_analyze(args: argparse.Namespace) -> int:
    try:
        config = _load_config(args.config)
    except (OSError, ValueError, TypeError) as error:
        args.parser.error(f"cannot load configuration {args.config}: {error}")
    try:
        outcome = analyze_track(args.audio, config, ArtifactStore(args.workspace))
    except InputError as error:
        args.parser.error(str(error))
    except SetVectorError as error:
        print(f"setvector: error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("setvector: interrupted; completed artifacts were kept", file=sys.stderr)
        return 130
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
        help="Extract baseline features from a local audio file",
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
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Parse arguments and run a command, returning its exit status."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0
    return args.handler(args)
