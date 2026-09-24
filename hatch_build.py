"""Refuse to build SetVector without the verified Beat This! weights."""

import runpy
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class WeightsHook(BuildHookInterface):
    """Fail the build when the bundled weights are missing or altered."""

    def initialize(self, version, build_data):
        weights = runpy.run_path(
            str(Path(self.root) / "src" / "setvector" / "models" / "weights.py")
        )
        path = weights["PATH"]
        if not path.is_file():
            raise RuntimeError(f"missing {path}; run: python scripts/fetch_model.py")
        if weights["weights_sha256"](path) != weights["SHA256"]:
            raise RuntimeError(
                f"{path} does not match its pinned SHA-256; rerun scripts/fetch_model.py"
            )
