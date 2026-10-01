"""Exercise the installed CLI through a real Python subprocess."""

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

import setvector.cli as cli
from setvector.domain import ArtifactError, DecodeError, InputError


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


@pytest.mark.parametrize("command", ["score", "compare"])
def test_unimplemented_commands_are_not_advertised(tmp_path, command):
    result = run_cli(command, cwd=tmp_path)
    assert result.returncode == 2
    assert "invalid choice" in result.stderr


def test_analyze_cli_emits_machine_json_and_reuses_cache(tmp_path, tone_path, config_path):
    workspace = Path("relative analysis workspace")
    arguments = ("analyze", str(tone_path), "--config", str(config_path))
    first = run_cli(*arguments, "--workspace", str(workspace), cwd=tmp_path)
    assert first.returncode == 0, first.stderr
    output = json.loads(first.stdout)
    assert set(output) == {
        "asset_id",
        "feature_id",
        "cache_hit",
        "manifest_path",
        "rhythm_id",
        "rhythm_source",
        "rhythm_reliable",
        "downbeat_count",
    }
    assert output["rhythm_source"] in ("beat_this", "setvector_fallback", "none")
    assert isinstance(output["rhythm_reliable"], bool)
    assert output["cache_hit"] is False
    manifest = Path(output["manifest_path"])
    assert manifest.is_absolute() and manifest.is_file()
    assert manifest.is_relative_to((tmp_path / workspace).resolve())
    assert "Traceback" not in first.stderr

    second = run_cli(*arguments, "--workspace", str(workspace), cwd=tmp_path)
    assert second.returncode == 0, second.stderr
    assert json.loads(second.stdout) == {**output, "cache_hit": True}


@pytest.mark.parametrize("filename", ["missing.wav", "corrupt.wav"])
def test_analyze_cli_maps_expected_input_errors_without_traceback(tmp_path, config_path, filename):
    if filename == "corrupt.wav":
        (tmp_path / filename).write_bytes(b"not an audio file")
    result = run_cli(
        "analyze",
        filename,
        "--config",
        str(config_path),
        "--workspace",
        str(tmp_path / "out"),
        cwd=tmp_path,
    )
    assert result.returncode == 2
    assert result.stdout == ""
    assert "error:" in result.stderr
    assert filename in result.stderr
    assert "Traceback" not in result.stderr
    assert not (tmp_path / "out" / "features").exists()


def test_analyze_cli_rejects_invalid_configuration(tmp_path, tone_path):
    config_path = tmp_path / "bad.json"
    config_path.write_text('{"schema_version": 1}', encoding="utf-8")
    result = run_cli(
        "analyze", str(tone_path), "--config", str(config_path), "--workspace", "w", cwd=tmp_path
    )
    assert result.returncode == 2
    assert result.stdout == ""
    assert "configuration" in result.stderr
    assert "Traceback" not in result.stderr


def test_analyze_requires_config_and_workspace(tmp_path, tone_path):
    result = run_cli("analyze", str(tone_path), cwd=tmp_path)
    assert result.returncode == 2
    assert "--config" in result.stderr


@pytest.mark.parametrize(
    "error", [ArtifactError("stored artifact is corrupt"), DecodeError("cannot decode")]
)
def test_processing_failures_exit_1_without_traceback(
    monkeypatch, capsys, tone_path, config_path, tmp_path, error
):
    def failing(*args, **kwargs):
        raise error

    monkeypatch.setattr(cli, "analyze_track", failing)
    code = cli.main(
        ["analyze", str(tone_path), "--config", str(config_path), "--workspace", str(tmp_path)]
    )
    captured = capsys.readouterr()
    assert code == 1
    assert captured.out == ""
    assert captured.err.strip() == f"setvector: error: {error}"


def test_warnings_go_to_stderr_after_json(monkeypatch, capsys, tmp_path, config_path):
    short = tmp_path / "short.wav"
    sf.write(short, np.zeros(100, dtype=np.float32), 8_000)
    code = cli.main(
        ["analyze", str(short), "--config", str(config_path), "--workspace", str(tmp_path / "w")]
    )
    captured = capsys.readouterr()
    assert code == 0
    assert json.loads(captured.out)["cache_hit"] is False
    assert "setvector: warning:" in captured.err
    assert "shorter than one" in captured.err


def analyze_for_report(tmp_path, tone_path, config_path):
    result = run_cli(
        "analyze", str(tone_path), "--config", str(config_path), "--workspace", "ws", cwd=tmp_path
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["feature_id"]


def test_report_cli_writes_self_contained_page(tmp_path, tone_path, config_path):
    feature_id = analyze_for_report(tmp_path, tone_path, config_path)
    result = run_cli("report", feature_id, "--workspace", "ws", cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    assert output == {
        "audio": "embedded",
        "feature_id": feature_id,
        "report_path": str((tmp_path / "ws" / "reports" / f"{feature_id}.html").resolve()),
    }
    assert Path(output["report_path"]).read_text(encoding="utf-8").startswith("<!DOCTYPE html>")

    again = run_cli("report", feature_id, "--workspace", "ws", cwd=tmp_path)
    assert again.returncode == 2
    assert "--overwrite" in again.stderr
    replaced = run_cli(
        "report", feature_id, "--workspace", "ws", "--overwrite", "--no-audio", cwd=tmp_path
    )
    assert replaced.returncode == 0, replaced.stderr
    assert json.loads(replaced.stdout)["audio"] == "none"


@pytest.mark.parametrize(
    "arguments, message",
    [
        (["f" * 64, "--workspace", "ws"], "no feature artifact"),
        (["bad-id", "--workspace", "ws"], "invalid feature ID"),
        (["f" * 64, "--workspace", "ws", "--audio", "x.wav", "--no-audio"], "not allowed with"),
    ],
)
def test_report_cli_input_errors(tmp_path, arguments, message):
    result = run_cli("report", *arguments, cwd=tmp_path)
    assert result.returncode == 2
    assert message in result.stderr
    assert result.stdout == ""
    assert "Traceback" not in result.stderr


def test_report_cli_processing_failure_exits_1(monkeypatch, capsys, tmp_path):
    def failing(*args, **kwargs):
        raise ArtifactError("stored artifact is corrupt")

    monkeypatch.setattr(cli, "render_report", failing)
    code = cli.main(["report", "f" * 64, "--workspace", str(tmp_path)])
    assert code == 1
    assert capsys.readouterr().err.strip() == "setvector: error: stored artifact is corrupt"


REKORDBOX_FIXTURE = Path(__file__).resolve().parent / "data" / "rekordbox-collection.xml"


def test_rekordbox_inspect_prints_a_summary(tmp_path):
    result = run_cli("rekordbox", "inspect", str(REKORDBOX_FIXTURE), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["track_count"] == 4
    assert summary["product"]["version"] == "7.2.18"


def test_rekordbox_inspect_of_a_missing_file_is_a_usage_error(tmp_path):
    result = run_cli("rekordbox", "inspect", str(tmp_path / "none.xml"), cwd=tmp_path)
    assert result.returncode == 2
    assert "cannot read Rekordbox XML" in result.stderr


def _fake_outcome(receipt, written_count=0):
    return SimpleNamespace(
        xml_path=Path("output.xml"),
        receipt_path=Path("output.xml.receipt.json"),
        written_count=written_count,
        receipt=receipt,
    )


@pytest.mark.parametrize(
    "add_arguments", [["--add", "a.mp3"], ["--add", "a.mp3", "--add", "b.mp3"]]
)
def test_rekordbox_export_parses_xml_placed_after_the_options(
    monkeypatch, capsys, tmp_path, config_path, add_arguments
):
    captured = {}

    def fake(xml, **kwargs):
        captured["xml"] = xml
        captured["add"] = kwargs["add"]
        return _fake_outcome({"unverified_override": False, "tracks": []})

    monkeypatch.setattr(cli, "build_rekordbox_import", fake)
    xml = tmp_path / "lib.xml"
    code = cli.main(
        [
            "rekordbox",
            "export",
            "--config",
            str(config_path),
            "--workspace",
            str(tmp_path / "w"),
            "--output",
            str(tmp_path / "o.xml"),
            *add_arguments,
            str(xml),
        ]
    )
    assert code == 0, capsys.readouterr().err
    assert captured["xml"] == xml
    assert captured["add"] == [Path(value) for value in add_arguments[1::2]]


def test_rekordbox_export_prints_warnings_for_skipped_omitted_and_unfit_cues(
    monkeypatch, capsys, tmp_path, config_path
):
    receipt = {
        "unverified_override": False,
        "tracks": [
            {
                "path": "dup.mp3",
                "in_library": True,
                "track_id": None,
                "grid": {"action": "omitted", "reasons": ["several library records for this file"]},
                "cues": [],
                "status": "skipped",
                "reason": "several library records for this file",
            },
            {
                "path": "missing.mp3",
                "in_library": True,
                "track_id": 1,
                "grid": {"action": "omitted", "reasons": ["audio file not found"]},
                "cues": [],
                "status": "unchanged",
            },
            {
                "path": "cues.mp3",
                "in_library": True,
                "track_id": 2,
                "grid": {"action": "kept", "markers": 4},
                "cues": [
                    {
                        "label": "Full",
                        "hot": True,
                        "start_seconds": 1.0,
                        "status": "no_free_slot",
                        "slot": None,
                    },
                    {
                        "label": "Over",
                        "hot": False,
                        "start_seconds": 2.0,
                        "status": "over_memory_limit",
                        "slot": None,
                    },
                    {
                        "label": "Moved",
                        "hot": True,
                        "start_seconds": 3.0,
                        "status": "moved_slot",
                        "slot": 3,
                    },
                ],
                "status": "written",
            },
        ],
    }

    def fake(xml, **kwargs):
        return _fake_outcome(receipt, written_count=1)

    monkeypatch.setattr(cli, "build_rekordbox_import", fake)
    code = cli.main(
        [
            "rekordbox",
            "export",
            str(tmp_path / "lib.xml"),
            "--config",
            str(config_path),
            "--workspace",
            str(tmp_path / "w"),
            "--output",
            str(tmp_path / "o.xml"),
        ]
    )
    captured = capsys.readouterr()
    assert code == 0
    output = json.loads(captured.out)
    assert output["written_count"] == 1
    assert output["unverified_override"] is False
    err = captured.err
    assert "setvector: warning: dup.mp3: skipped: several library records for this file" in err
    assert "setvector: warning: missing.mp3: no grid written: audio file not found" in err
    assert err.count("no grid written") == 1
    assert "setvector: warning: cues.mp3: cue 'Full' not written: no free slot" in err
    assert "setvector: warning: cues.mp3: cue 'Over' not written: over memory limit" in err
    assert (
        "setvector: warning: cues.mp3: cue 'Moved' placed in hot cue slot D instead of the "
        "requested one"
    ) in err


def test_rekordbox_export_warns_about_tracks_written_as_new(
    monkeypatch, capsys, tmp_path, config_path
):
    receipt = {
        "unverified_override": False,
        "new_tracks": ["a.mp3", "b.mp3"],
        "tracks": [],
    }

    def fake(xml, **kwargs):
        return _fake_outcome(receipt, written_count=2)

    monkeypatch.setattr(cli, "build_rekordbox_import", fake)
    xml = tmp_path / "lib.xml"
    code = cli.main(
        [
            "rekordbox",
            "export",
            str(xml),
            "--config",
            str(config_path),
            "--workspace",
            str(tmp_path / "w"),
            "--output",
            str(tmp_path / "o.xml"),
        ]
    )
    err = capsys.readouterr().err
    assert code == 0
    assert (
        f"setvector: warning: 2 track(s) are not in {xml} and were written as new; export "
        "the full collection (File → Export Collection) first if any of them are already "
        "in Rekordbox"
    ) in err


def test_rekordbox_export_bad_cues_file_is_a_usage_error(capsys, tmp_path, config_path):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(
            [
                "rekordbox",
                "export",
                str(tmp_path / "lib.xml"),
                "--config",
                str(config_path),
                "--workspace",
                str(tmp_path / "w"),
                "--output",
                str(tmp_path / "o.xml"),
                "--cues",
                str(tmp_path / "missing_cues.json"),
            ]
        )
    assert excinfo.value.code == 2
    assert "cannot read cue requests" in capsys.readouterr().err


def test_rekordbox_export_unqualified_version_is_a_usage_error(
    monkeypatch, capsys, tmp_path, config_path
):
    def fake(xml, **kwargs):
        raise InputError(
            "Rekordbox 7.2.19 has not been qualified for updating tracks already in the "
            "collection; run scripts/rekordbox_probe.py to qualify it, or pass "
            "--unverified-rekordbox"
        )

    monkeypatch.setattr(cli, "build_rekordbox_import", fake)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(
            [
                "rekordbox",
                "export",
                str(tmp_path / "lib.xml"),
                "--config",
                str(config_path),
                "--workspace",
                str(tmp_path / "w"),
                "--output",
                str(tmp_path / "o.xml"),
            ]
        )
    assert excinfo.value.code == 2
    assert "rekordbox_probe" in capsys.readouterr().err
