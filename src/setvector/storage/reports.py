"""Atomic writes for generated files such as reports and Rekordbox XML."""

import os
import tempfile
from pathlib import Path

from setvector.domain import ArtifactError, InputError


def write_file(
    path: str | Path, data: bytes, *, overwrite: bool = False, kind: str = "file"
) -> Path:
    """Write ``data`` to ``path`` through a temporary sibling file and return the absolute path.

    An existing file is replaced only when ``overwrite`` is true. ``kind`` names the file
    in error messages.
    """
    target = Path(path).resolve()
    if target.is_dir():
        raise InputError(f"{kind} path is a directory: {target}")
    if target.exists() and not overwrite:
        raise InputError(f"{kind} already exists: {target}; pass --overwrite to replace it")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
    except OSError as error:
        raise ArtifactError(f"cannot write {kind} {target}: {error}") from error
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        raise ArtifactError(f"cannot write {kind} {target}: {error}") from error
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return target


def write_report(path: str | Path, html: str, overwrite: bool = False) -> Path:
    """Write an HTML report atomically; an existing file is replaced only with ``overwrite``."""
    return write_file(path, html.encode("utf-8"), overwrite=overwrite, kind="report")
