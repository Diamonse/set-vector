"""Download the Beat This! checkpoint, convert it to ``.npz``, and verify both hashes.

Run once in a source checkout with the project venv, which provides PyTorch and NumPy:

    python scripts/fetch_model.py

This is the only code that unpickles the checkpoint (with ``weights_only=True``).
SetVector itself loads the converted ``.npz`` with ``allow_pickle=False``.
"""

import runpy
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = runpy.run_path(str(ROOT / "src" / "setvector" / "models" / "weights.py"))


def download(url: str, directory: Path) -> Path | None:
    """Stream ``url`` into a temporary ``.ckpt.part`` file in ``directory``; return its path.

    Returns ``None`` (after printing an error to stderr) if the download raises ``OSError``.
    """
    with tempfile.NamedTemporaryFile(dir=directory, suffix=".ckpt.part", delete=False) as part:
        temporary = Path(part.name)
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                while block := response.read(1 << 20):
                    part.write(block)
        except BaseException as error:
            part.close()
            temporary.unlink(missing_ok=True)
            if isinstance(error, OSError):
                print(f"error: cannot download the checkpoint: {error}", file=sys.stderr)
                return None
            raise
    return temporary


def convert(checkpoint: Path, target: Path) -> None:
    """Write the checkpoint's model tensors, without their ``model.`` prefix, to ``target``."""
    import numpy as np
    import torch

    state = torch.load(checkpoint, map_location="cpu", weights_only=True)["state_dict"]
    arrays = {
        name.removeprefix("model."): tensor.numpy()
        for name, tensor in state.items()
        if name.startswith("model.")
    }
    with target.open("wb") as stream:  # a file object stops NumPy appending ".npz"
        np.savez(stream, **arrays)


def main() -> int:
    target, expected = WEIGHTS["PATH"], WEIGHTS["SHA256"]
    if target.is_file() and WEIGHTS["weights_sha256"](target) == expected:
        print(f"weights already present: {target}")
        return 0
    checkpoint = download(WEIGHTS["SOURCE_URL"], target.parent)
    if checkpoint is None:
        return 1
    partial = target.with_name(target.name + ".part")
    try:
        actual = WEIGHTS["sha256_file"](checkpoint)
        if actual != WEIGHTS["SOURCE_SHA256"]:
            print(
                f"error: downloaded checkpoint has SHA-256 {actual}, "
                f"expected {WEIGHTS['SOURCE_SHA256']}",
                file=sys.stderr,
            )
            return 1
        convert(checkpoint, partial)
        actual = WEIGHTS["weights_sha256"](partial)
        if actual != expected:
            print(
                f"error: converted weights have SHA-256 {actual}, expected {expected}",
                file=sys.stderr,
            )
            return 1
        partial.replace(target)
    finally:
        checkpoint.unlink(missing_ok=True)
        partial.unlink(missing_ok=True)
    print(f"weights verified: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
