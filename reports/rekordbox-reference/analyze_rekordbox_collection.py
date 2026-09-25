"""Analyze every local track referenced by a Rekordbox XML export.

Results are appended after each track, so restarting the script resumes the batch.
"""
import gc
import json
import time
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET

from setvector.application import analyze_track
from setvector.domain import AnalysisConfig
from setvector.storage import ArtifactStore

SOURCE = Path(r"C:\Users\aryan\Downloads\Rekordbox\collection_1.xml")
CONFIG = Path(r"C:\Users\aryan\OneDrive\Documents\GitHub\set-vector\.worktrees\rhythm-engine\examples\analysis-config.json")
OUTPUT_DIR = Path(r"C:\Users\aryan\.codex\visualizations\2026\09\24\01a0d420-275a-7470-9a77-be651ed71970")
WORKSPACE = OUTPUT_DIR / "analysis-workspace"
INDEX = OUTPUT_DIR / "collection-analysis.jsonl"

def path_from_uri(uri: str) -> Path:
    parsed = urlparse(uri)
    return Path(unquote(parsed.path).lstrip("/"))

def main() -> None:
    tracks = ET.parse(SOURCE).getroot().findall("./COLLECTION/TRACK")
    completed = {}
    if INDEX.is_file():
        for line in INDEX.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                completed[record["track_id"]] = record
    config = AnalysisConfig.from_dict(json.loads(CONFIG.read_text(encoding="utf-8")))
    store = ArtifactStore(WORKSPACE)
    started = time.monotonic()
    failures = 0
    print(f"START records={len(tracks)} previously_recorded={len(completed)} workspace={WORKSPACE}", flush=True)
    with INDEX.open("a", encoding="utf-8") as out:
        for number, track in enumerate(tracks, 1):
            track_id = track.get("TrackID", "")
            if track_id in completed:
                continue
            audio_path = path_from_uri(track.get("Location", ""))
            record = {
                "track_id": track_id,
                "xml_name": track.get("Name", ""),
                "xml_artist": track.get("Artist", ""),
                "audio_path": str(audio_path),
                "xml_tempo_markers": len(track.findall("TEMPO")),
            }
            began = time.monotonic()
            if not audio_path.is_file():
                record.update(status="missing_audio")
            else:
                try:
                    outcome = analyze_track(audio_path, config, store)
                    rhythm = outcome.rhythm
                    record.update(
                        status="analyzed",
                        asset_id=outcome.asset.asset_id,
                        feature_id=outcome.features.feature_id,
                        rhythm_id=rhythm.rhythm_id,
                        source=rhythm.source,
                        reliable=rhythm.reliable,
                        tempo_bpm=rhythm.tempo_bpm,
                        beat_count=len(rhythm.beats),
                        downbeat_count=len(rhythm.downbeats),
                        baseline_cache_hit=outcome.cache_hit,
                        rhythm_cache_hit=outcome.rhythm_cache_hit,
                        reasons=list(rhythm.reasons),
                        warnings=list(outcome.features.measurements.diagnostics.warnings),
                    )
                except Exception as error:
                    failures += 1
                    record.update(status="analysis_error", error_type=type(error).__name__, error=str(error))
            record["seconds"] = round(time.monotonic() - began, 2)
            out.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            out.flush()
            completed[track_id] = record
            gc.collect()
            if number % 5 == 0 or record["status"] != "analyzed" or number == len(tracks):
                analyzed = sum(r["status"] == "analyzed" for r in completed.values())
                missing = sum(r["status"] == "missing_audio" for r in completed.values())
                errors = sum(r["status"] == "analysis_error" for r in completed.values())
                print(
                    f"PROGRESS {number}/{len(tracks)} analyzed={analyzed} missing={missing} errors={errors} "
                    f"elapsed_s={time.monotonic()-started:.1f} last_s={record['seconds']}",
                    flush=True,
                )
    print(f"DONE recorded={len(completed)} failures={failures} elapsed_s={time.monotonic()-started:.1f}", flush=True)

if __name__ == "__main__":
    main()
