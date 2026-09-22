"""Command-line interface for SetVector."""

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from setvector import AnalysisConfig, __version__


def _unique_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields = {}
    for key, value in pairs:
        if key in fields:
            raise ValueError(f"duplicate field: {key}")
        fields[key] = value
    return fields


def main(argv: Sequence[str] | None = None) -> int:
    """Parse arguments and run a command, returning its exit status."""
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

    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return 0

    try:
        data = json.loads(
            args.path.read_text(encoding="utf-8-sig"), object_pairs_hook=_unique_fields
        )
        config = AnalysisConfig.from_dict(data)
    except (OSError, ValueError, TypeError) as error:
        validate_parser.error(f"cannot validate {args.path}: {error}")

    print(json.dumps({"config_id": config.config_id, "config": config.to_dict()}, sort_keys=True))
    return 0
