"""Qualify a Rekordbox version's XML import with synthetic drum tracks.

Run ``generate``, import ``stage1.xml`` in Rekordbox as CHECKLIST.md describes, then run
``stage2`` and ``check``. The probe never touches a real track.
"""

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import soundfile as sf

from setvector.application import build_rekordbox_import
from setvector.domain import AnalysisConfig, InputError, SetVectorError
from setvector.rekordbox import CapabilityProfile, CueRequest, compare_libraries, read_library
from setvector.storage import ArtifactStore

SAMPLE_RATE = 44_100
REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG = REPO_ROOT / "examples" / "analysis-config.json"
PROBE_PROFILE = CapabilityProfile((), 8, 100, None, None, None)
TRACKS = {
    "probe-1-constant-120.wav": (((120.0, 44),), 0.5),
    "probe-2-tempo-change.wav": (((120.0, 22), (128.0, 24)), 0.5),
    "probe-3-late-start.wav": (((124.0, 44),), 2.3),
}
ONE, TWO, THREE = TRACKS
COLOURS = (
    (255, 55, 111),
    (69, 172, 219),
    (48, 90, 255),
    (40, 226, 20),
    (224, 100, 27),
    (165, 225, 22),
    (180, 50, 255),
    (255, 18, 123),
)
CHECKLIST = (
    """# Rekordbox probe

Probe folder: `{folder}`

Run the commands from the SetVector folder (`{repo}`) in PowerShell.

- In Preferences → Analysis, switch off automatic analysis and CUE Analysis before importing.
- Back up your Rekordbox library first (File → Library → Backup Library).
- Use Rekordbox 7.2.19; export with File → Export Collection in xml format.

1. Rekordbox → Preferences → View → Layout: enable **rekordbox xml**.
2. Preferences → Advanced → Database → rekordbox xml → Imported Library: choose `stage1.xml`.
3. Write down the Rekordbox version, Windows version and Preferences → Analysis settings
   (auto analysis, BPM range, dynamic analysis, CUE analysis).
4. In the browser tree open **rekordbox xml → All Tracks**, select the three probe tracks,
   right-click → **Import To Collection**. Write down any prompt text. Wait for analysis.
5. In Collection, play hot cue A and the first memory cue of `probe-1-constant-120`.
   Note whether each lands on the crash at the start of a bar. On `probe-2-tempo-change`,
   check that the grid follows the tempo change at bar 23 with no extra gridline or odd
   bar just before it.
6. On `probe-1-constant-120`, set hot cue **G** by hand on any beat and add one memory cue
   by hand.
7. File → Export Collection in xml format → save as `export-1.xml` in the probe folder.
8. Run this command:

   ```powershell
   """
    '.\\.venv\\Scripts\\python.exe scripts\\rekordbox_probe.py stage2 "{folder}" '
    '--library "{folder}/export-1.xml"'
    """
   ```

9. Point Imported Library to `stage2.xml`, open **rekordbox xml → All Tracks**, select
   `probe-1-constant-120` → **Import To Collection**. Write down any prompt. Import it a
   second time.
10. Export the collection again as `export-2.xml` in the probe folder.
11. Run this command and keep `probe-results.json`:

    ```powershell
    """
    '.\\.venv\\Scripts\\python.exe scripts\\rekordbox_probe.py check "{folder}" '
    '--export1 "{folder}/export-1.xml" --export2 "{folder}/export-2.xml"'
    """
    ```

12. Remove the three probe tracks from the Collection. Afterwards the probe folder (the WAVs,
    the XML files and SetVector's `workspace` cache) can be deleted; keep `probe-results.json`
    and your notes.

In stage 1, the hand-made cues from step 6 appear as `extra`. In stage 2 they are part of
what SetVector wrote, so `missing` or `duplicated` there means Rekordbox lost or doubled them.
"""
)


def drum_track(sections, lead_in):
    """Return stereo float32 samples and downbeat times for ``(bpm, bars)`` sections.

    Kick on every beat, snare on 2 and 4, off-beat hats, a bass note on every bar and a
    crash every fourth bar, after ``lead_in`` seconds of silence.
    """
    beats = []
    time = lead_in
    for bpm, bars in sections:
        for _ in range(bars * 4):
            beats.append(time)
            time += 60.0 / bpm
    size = int(SAMPLE_RATE * (time + 1.0))
    signal = np.zeros(size)
    rng = np.random.default_rng(7)

    def put(sound, at, gain):
        start = int(round(at * SAMPLE_RATE))
        signal[start : start + sound.size] += gain * sound[: size - start]

    def decay(seconds, tau):
        return np.exp(-np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE / tau)

    t = np.arange(int(0.2 * SAMPLE_RATE)) / SAMPLE_RATE
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    snare = rng.standard_normal(int(0.15 * SAMPLE_RATE)) * decay(0.15, 0.04)
    hat = rng.standard_normal(int(0.04 * SAMPLE_RATE)) * decay(0.04, 0.01)
    crash = rng.standard_normal(SAMPLE_RATE) * decay(1.0, 0.3)
    for index, beat in enumerate(beats):
        put(kick, beat, 0.9)
        if index % 4 in (1, 3):
            put(snare, beat, 0.5)
        following = beats[index + 1] if index + 1 < len(beats) else time
        put(hat, (beat + following) / 2, 0.2)
    downbeats = beats[::4]
    for bar, downbeat in enumerate(downbeats):
        end = downbeats[bar + 1] if bar + 1 < len(downbeats) else time
        bar_t = np.arange(int((end - downbeat) * SAMPLE_RATE)) / SAMPLE_RATE
        root = (55.0, 43.65, 49.0, 41.2)[bar % 4]
        put(np.sin(2 * np.pi * root * bar_t) * np.minimum(1, bar_t / 0.01), downbeat, 0.3)
        if bar % 4 == 0:
            put(crash, downbeat, 0.3)
    signal = 0.9 * signal / np.abs(signal).max()
    return np.stack([signal, signal], axis=1).astype(np.float32), downbeats


def stage_requests(folder, downbeats, stage):
    """Cue requests per probe track; stage 2 moves, removes, adds and renames cues."""
    first, second, third = (downbeats[name] for name in TRACKS)
    one = [
        CueRequest(f"Hot {'ABCDEF'[i]}", first[2 * i], True, preferred_slot=i, colour=COLOURS[i])
        for i in range(6)
    ]
    one += [
        CueRequest(f"Mem {i + 1:02d}", first[12 + i], False, colour=COLOURS[i % 8])
        for i in range(12)
    ]
    one.append(CueRequest("Loop", first[26], False, kind="loop", end_seconds=first[27]))
    if stage == 2:
        one = [request for request in one if request.label != "Hot B"]
        one = [
            replace(request, start_seconds=first[9])
            if request.label == "Hot A"
            else replace(request, label="Mem 01b")
            if request.label == "Mem 01"
            else request
            for request in one
        ]
        one.append(CueRequest("Hot N", first[30], True, preferred_slot=7, colour=COLOURS[7]))
    two = [
        CueRequest(f"Hot {'ABCDEFGH'[i]}", second[5 * i], True, preferred_slot=i, colour=COLOURS[i])
        for i in range(8)
    ]
    three = [
        CueRequest("Hot A", third[0], True, preferred_slot=0, colour=COLOURS[0]),
        CueRequest("Mem 01", third[0], False),
        CueRequest("Mem 09", third[8], False),
    ]
    return {folder / ONE: tuple(one), folder / TWO: tuple(two), folder / THREE: tuple(three)}


def _export(folder, library, name, requests):
    config = AnalysisConfig.from_dict(json.loads(CONFIG.read_text(encoding="utf-8")))
    return build_rekordbox_import(
        library,
        config=config,
        store=ArtifactStore(folder / "workspace"),
        output=folder / name,
        add=[folder / track for track in TRACKS],
        cues=requests,
        allow_unverified=True,
        overwrite=True,
        profile=PROBE_PROFILE,
        playlist_name="SetVector probe",
    )


def generate(args) -> int:
    folder = args.folder.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    downbeats = {}
    for name, (sections, lead_in) in TRACKS.items():
        samples, downbeats[name] = drum_track(sections, lead_in)
        sf.write(folder / name, samples, SAMPLE_RATE, subtype="PCM_16")
    probe = {"downbeats": downbeats}
    (folder / "probe.json").write_text(json.dumps(probe, indent=2) + "\n", encoding="utf-8")
    outcome = _export(folder, None, "stage1.xml", stage_requests(folder, downbeats, 1))
    failed = [r["path"] for r in outcome.receipt["tracks"] if r["grid"]["action"] != "added"]
    if failed:
        print(
            f"no Beat This! grid for {', '.join(failed)}; see {outcome.receipt_path}",
            file=sys.stderr,
        )
        return 1
    checklist = CHECKLIST.format(folder=folder, repo=REPO_ROOT)
    (folder / "CHECKLIST.md").write_text(checklist, encoding="utf-8")
    print(f"wrote {outcome.xml_path}; follow {folder / 'CHECKLIST.md'}")
    return 0


def stage2(args) -> int:
    folder = args.folder.resolve()
    probe_path = folder / "probe.json"
    if not probe_path.is_file():
        raise InputError(f"{folder} has no probe.json; run generate first")
    downbeats = json.loads(probe_path.read_text(encoding="utf-8"))["downbeats"]
    outcome = _export(folder, args.library, "stage2.xml", stage_requests(folder, downbeats, 2))
    print(f"wrote {outcome.xml_path} with {outcome.written_count} track(s)")
    return 0


def check(args) -> int:
    folder = args.folder.resolve()
    results = {}
    for stage, export in (("stage1", args.export1), ("stage2", args.export2)):
        if export is None:
            continue
        findings = compare_libraries(read_library(folder / f"{stage}.xml"), read_library(export))
        results[stage] = findings
        print(f"== {stage}")
        for finding in findings:
            detail = f" ({finding['detail']})" if finding["detail"] else ""
            print(f"{finding['track']}: {finding['item']}: {finding['result']}{detail}")
    text = json.dumps(results, indent=2, ensure_ascii=False) + "\n"
    (folder / "probe-results.json").write_text(text, encoding="utf-8")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    generate_parser = commands.add_parser("generate", help="Write drum tracks and stage1.xml")
    generate_parser.add_argument("folder", type=Path)
    stage2_parser = commands.add_parser("stage2", help="Write stage2.xml from export-1.xml")
    stage2_parser.add_argument("folder", type=Path)
    stage2_parser.add_argument("--library", type=Path, required=True)
    check_parser = commands.add_parser("check", help="Compare Rekordbox exports with the stages")
    check_parser.add_argument("folder", type=Path)
    check_parser.add_argument(
        "--export1", type=Path, required=True, help="Rekordbox export after stage 1"
    )
    check_parser.add_argument("--export2", type=Path, help="Rekordbox export after stage 2")
    args = parser.parse_args(argv)
    try:
        return {"generate": generate, "stage2": stage2, "check": check}[args.command](args)
    except (SetVectorError, OSError, json.JSONDecodeError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
