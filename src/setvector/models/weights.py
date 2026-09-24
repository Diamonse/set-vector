"""Identity of the bundled Beat This! weights.

This module uses only the standard library so the build hook and the fetch script can
load it with ``runpy`` before SetVector or NumPy is installed.
"""

import hashlib
import zipfile
from pathlib import Path

NAME = "final0"
UPSTREAM_VERSION = "1.1.0"
UPSTREAM_COMMIT = "b95c8ab"
SOURCE_URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt"
SOURCE_SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
FILE_NAME = "beat_this-final0.npz"
SHA256 = "c023aa1a8f9ce435c0639568c4478314765f54304588319fbd0022a4992893a7"
PATH = Path(__file__).resolve().parent / FILE_NAME


def sha256_file(path: Path) -> str:
    """Return the lowercase SHA-256 of the bytes of ``path``, read in 1 MiB blocks."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def weights_sha256(path: Path) -> str:
    """Return a SHA-256 over the sorted member names and bytes of the ``.npz`` at ``path``.

    Unlike a file hash, it ignores zip timestamps, compression, and member order.
    """
    digest = hashlib.sha256()
    with zipfile.ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            digest.update(name.encode() + b"\0")
            with archive.open(name) as member:
                for block in iter(lambda: member.read(1 << 20), b""):
                    digest.update(block)
    return digest.hexdigest()
