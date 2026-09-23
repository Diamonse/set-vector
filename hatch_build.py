"""Refuse to build SetVector without the verified Beat This! checkpoint."""

import runpy
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CheckpointHook(BuildHookInterface):
    """Fail the build when the bundled checkpoint is missing or altered."""

    def initialize(self, version, build_data):
        checkpoint = runpy.run_path(
            str(Path(self.root) / "src" / "setvector" / "models" / "checkpoint.py")
        )
        path = checkpoint["PATH"]
        if not path.is_file():
            raise RuntimeError(f"missing {path}; run: python scripts/fetch_model.py")
        if checkpoint["sha256_file"](path) != checkpoint["SHA256"]:
            raise RuntimeError(
                f"{path} does not match its pinned SHA-256; rerun scripts/fetch_model.py"
            )
