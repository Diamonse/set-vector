"""Download the Beat This! checkpoint into the package and verify its SHA-256.

Run once in a source checkout before installing or building SetVector:

    python scripts/fetch_model.py
"""

import runpy
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT = runpy.run_path(str(ROOT / "src" / "setvector" / "models" / "checkpoint.py"))


def main() -> int:
    target, expected = CHECKPOINT["PATH"], CHECKPOINT["SHA256"]
    sha256_file = CHECKPOINT["sha256_file"]
    if target.is_file() and sha256_file(target) == expected:
        print(f"checkpoint already present: {target}")
        return 0
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".part", delete=False) as part:
        temporary = Path(part.name)
        with urllib.request.urlopen(CHECKPOINT["URL"], timeout=60) as response:
            while block := response.read(1 << 20):
                part.write(block)
    actual = sha256_file(temporary)
    if actual != expected:
        temporary.unlink()
        print(
            f"error: downloaded checkpoint has SHA-256 {actual}, expected {expected}",
            file=sys.stderr,
        )
        return 1
    temporary.replace(target)
    print(f"checkpoint verified: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
