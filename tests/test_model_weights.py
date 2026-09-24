"""The bundled Beat This! weights are present and match their pinned hash."""

import hashlib
import zipfile

from setvector.models import weights


def test_bundled_weights_match_pinned_hash():
    assert weights.PATH.is_file(), "missing weights: run python scripts/fetch_model.py"
    assert weights.weights_sha256(weights.PATH) == weights.SHA256


def test_sha256_file_reads_large_files_in_blocks(tmp_path):
    data = b"a" * (3 * 2**20 + 5)
    path = tmp_path / "blob.bin"
    path.write_bytes(data)
    assert weights.sha256_file(path) == hashlib.sha256(data).hexdigest()


def _archive(path, members):
    with zipfile.ZipFile(path, "w") as archive:
        for name, data, date_time in members:
            archive.writestr(zipfile.ZipInfo(name, date_time=date_time), data)
    return path


def test_weights_hash_ignores_member_order_and_timestamps(tmp_path):
    first = _archive(
        tmp_path / "a.npz",
        [("x.npy", b"one", (1980, 1, 1, 0, 0, 0)), ("y.npy", b"two", (1980, 1, 1, 0, 0, 0))],
    )
    second = _archive(
        tmp_path / "b.npz",
        [("y.npy", b"two", (2024, 5, 6, 7, 8, 10)), ("x.npy", b"one", (2021, 1, 1, 0, 0, 0))],
    )
    changed = _archive(
        tmp_path / "c.npz",
        [("x.npy", b"one", (1980, 1, 1, 0, 0, 0)), ("y.npy", b"TWO", (1980, 1, 1, 0, 0, 0))],
    )
    assert weights.weights_sha256(first) == weights.weights_sha256(second)
    assert weights.weights_sha256(first) != weights.weights_sha256(changed)
