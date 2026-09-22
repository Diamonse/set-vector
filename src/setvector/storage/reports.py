"""Atomic writes for generated report files."""

import os
import tempfile
from pathlib import Path

from setvector.domain import ArtifactError, InputError


def write_report(path: str | Path, html: str, overwrite: bool = False) -> Path:
    """Write ``html`` to ``path`` through a temporary sibling file and return the absolute path.

    An existing file is replaced only when ``overwrite`` is true.
    """
    target = Path(path).resolve()
    if target.is_dir():
        raise InputError(f"report path is a directory: {target}")
    if target.exists() and not overwrite:
        raise InputError(f"report already exists: {target}; pass --overwrite to replace it")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
    except OSError as error:
        raise ArtifactError(f"cannot write report {target}: {error}") from error
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(html.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        raise ArtifactError(f"cannot write report {target}: {error}") from error
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return target
