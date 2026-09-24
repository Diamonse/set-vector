"""Atomic publication of artifact directories and strict JSON file helpers."""

import json
import os
import shutil
import tempfile
from collections.abc import Callable, Mapping
from pathlib import Path

from setvector.domain import ArtifactError

from .canonical import strict_json_loads


def write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` and flush it to disk."""
    with path.open("wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def write_json(path: Path, value: Mapping[str, object]) -> None:
    """Write indented, key-sorted UTF-8 JSON without NaN or infinity."""
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
    write_bytes(path, (text + "\n").encode("utf-8"))


def read_json(path: Path) -> object:
    """Parse JSON strictly: duplicate keys and NaN or infinity are errors."""
    return strict_json_loads(path.read_text(encoding="utf-8"))


def publish_directory(target: Path, write: Callable[[Path], None]) -> bool:
    """Write into a sibling temporary directory and rename it to ``target``.

    Returns ``False`` when another writer published ``target`` first.
    """
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{target.name}.tmp-", dir=target.parent))
    except OSError as error:
        raise ArtifactError(f"cannot create artifact directory {target}: {error}") from error
    try:
        write(temporary)
        os.replace(temporary, target)
    except OSError as error:
        shutil.rmtree(temporary, ignore_errors=True)
        if target.exists():
            return False
        raise ArtifactError(f"cannot publish artifact {target}: {error}") from error
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return True
