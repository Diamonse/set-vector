"""The installed analysis workflow must run with network access blocked."""

import json
import os
import subprocess
import sys

import pytest

BLOCKER = """import socket


def blocked(*args, **kwargs):
    raise AssertionError("network access attempted")


socket.create_connection = blocked
socket.getaddrinfo = blocked
socket.socket.connect = blocked
socket.socket.connect_ex = blocked
"""


@pytest.fixture
def offline_environment(tmp_path):
    blocker = tmp_path / "network_blocker"
    blocker.mkdir()
    (blocker / "sitecustomize.py").write_text(BLOCKER, encoding="utf-8")
    environment = os.environ.copy()
    environment["PYTHONPATH"] = str(blocker)
    return environment


def test_socket_blocker_is_active(tmp_path, offline_environment):
    probe = "import socket; socket.create_connection(('127.0.0.1', 9))"
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=tmp_path,
        env=offline_environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "network access attempted" in result.stderr


def test_analyze_and_cache_work_with_network_sockets_blocked(
    tmp_path, tone_path, config_path, offline_environment
):
    workspace = tmp_path / "offline workspace"
    command = [
        sys.executable,
        "-m",
        "setvector",
        "analyze",
        str(tone_path),
        "--config",
        str(config_path),
        "--workspace",
        str(workspace),
    ]

    def run():
        return subprocess.run(
            command,
            cwd=tmp_path,
            env=offline_environment,
            capture_output=True,
            text=True,
            check=False,
        )

    first = run()
    second = run()
    assert first.returncode == 0, first.stderr
    assert json.loads(first.stdout)["cache_hit"] is False
    assert second.returncode == 0, second.stderr
    assert json.loads(second.stdout)["cache_hit"] is True
    assert "network access attempted" not in first.stderr + second.stderr
