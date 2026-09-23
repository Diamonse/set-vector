"""The bundled Beat This! checkpoint is present and matches its pinned hash."""

import hashlib

from setvector.models import checkpoint


def test_bundled_checkpoint_matches_pinned_hash():
    assert checkpoint.PATH.is_file(), "missing checkpoint: run python scripts/fetch_model.py"
    assert checkpoint.sha256_file(checkpoint.PATH) == checkpoint.SHA256


def test_sha256_file_reads_large_files_in_blocks(tmp_path):
    data = b"a" * (3 * 2**20 + 5)
    path = tmp_path / "blob.bin"
    path.write_bytes(data)
    assert checkpoint.sha256_file(path) == hashlib.sha256(data).hexdigest()
