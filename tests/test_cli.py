"""Exercise the installed CLI through a real Python subprocess."""

import json
import subprocess
import sys

import pytest


def run_cli(*args, cwd):
    return subprocess.run(
        [sys.executable, "-m", "setvector", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def test_help_runs_outside_the_checkout(tmp_path):
    result = run_cli("--help", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert "config" in result.stdout
    assert "--version" in result.stdout
    assert result.stderr == ""


def test_version_matches_installed_distribution(tmp_path):
    from importlib.metadata import version

    result = run_cli("--version", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == f"setvector {version('setvector')}"


def test_validate_config_accepts_a_unicode_path_and_returns_json(tmp_path):
    directory = tmp_path / "música library"
    directory.mkdir()
    config_path = directory / "analysis settings.json"
    config = {
        "schema_version": 1,
        "sample_rate": None,
        "frame_length": 2048,
        "hop_length": 512,
        "channel_policy": "mono",
    }
    config_path.write_text(json.dumps(config), encoding="utf-8")

    result = run_cli("config", "validate", str(config_path), cwd=tmp_path)

    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output["config"] == config
    assert len(output["config_id"]) == 64
    assert result.stderr == ""


@pytest.mark.parametrize(
    "content",
    [
        "{broken JSON",
        "[]",
        '{"schema_version": 99}',
        '{"schema_version": 1, "sample_rate": null, "frame_length": 0, '
        '"hop_length": 512, "channel_policy": "mono"}',
        '{"schema_version": 99, "schema_version": 1, "sample_rate": null, '
        '"frame_length": 2048, "hop_length": 512, "channel_policy": "mono"}',
    ],
)
def test_validate_rejects_invalid_config_without_a_traceback(tmp_path, content):
    config_path = tmp_path / "invalid.json"
    config_path.write_text(content, encoding="utf-8")

    result = run_cli("config", "validate", str(config_path), cwd=tmp_path)

    assert result.returncode == 2
    assert result.stdout == ""
    assert "error:" in result.stderr
    assert "Traceback" not in result.stderr


def test_missing_config_has_a_clear_error(tmp_path):
    result = run_cli("config", "validate", "missing.json", cwd=tmp_path)
    assert result.returncode == 2
    assert result.stdout == ""
    assert "missing.json" in result.stderr
    assert "Traceback" not in result.stderr


def test_unimplemented_commands_are_not_advertised(tmp_path):
    result = run_cli("analyze", "track.wav", cwd=tmp_path)
    assert result.returncode == 2
    assert "invalid choice" in result.stderr
