"""Identity of the bundled Beat This! checkpoint.

This module imports nothing from SetVector so the build hook and the fetch script
can load it with ``runpy`` before the package is installed.
"""

import hashlib
from pathlib import Path

NAME = "final0"
FILE_NAME = "beat_this-final0.ckpt"
SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt"
PATH = Path(__file__).resolve().parent / FILE_NAME


def sha256_file(path: Path) -> str:
    """Return the lowercase SHA-256 of ``path``, read in 1 MiB blocks."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
