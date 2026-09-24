"""Build a local, auditable Rekordbox/SetVector collection comparison.

The Rekordbox XML contains beat-grid anchors, not every beat. This script
expands each TEMPO segment to the decoded audio duration, then compares the
resulting grids with SetVector's stored rhythm artifacts. Agreement with the
export is not a measurement of musical ground truth.
"""

from __future__ import annotations

import json
import math
import statistics
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree as ET


ROOT = Path(r"C:\Users\aryan\.codex\visualizations\2026\09\24\01a0d420-275a-7470-9a77-be651ed71970")
XML_PATH = Path(r"C:\Users\aryan\Downloads\Rekordbox\collection_1.xml")
INDEX_PATH = ROOT / "collection-analysis.jsonl"
WORKSPACE = ROOT / "analysis-workspace"
OUTPUT_PATH = ROOT / "collection-comparison.json"
TOLERANCE_SECONDS = 0.040
SECONDARY_TOLERANCE_SECONDS = 0.080


def audio_path_from_uri(uri: str) -> str:
    parsed = urlparse(uri)
    return str(Path(unquote(parsed.path).lstrip("/")))


def number(text: str | None) -> float | None:
    try:
        value = float(text) if text is not None else None
    except ValueError:
        return None
    return value if value is not None and math.isfinite(value) else None


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def decoded_duration(asset: dict, feature: dict) -> float:
    """Match SetVector's report duration formula, avoiding unreliable MP3 headers."""
    config = feature["extractor"]["config"]
    diagnostics = feature["diagnostics"]
    sample_rate = config["sample_rate"] or asset["native_sample_rate"]
    frames = diagnostics["analyzed_frames"]
    samples = (frames - 1) * config["hop_length"] + config["frame_length"] if frames else 0
    samples += diagnostics["omitted_tail_samples"]
    return samples / sample_rate


def marker_grid(markers: list[dict], duration: float) -> tuple[list[float], list[int]]:
    """Expand each Rekordbox TEMPO anchor to the next anchor or decoded EOF.

    Inizio is a beat timestamp; Bpm gives spacing; Battito gives bar position.
    A later anchor resets both timing and bar phase, even at the same BPM.
    """
    parsed = []
    for original_index, marker in enumerate(markers):
        start = number(marker.get("Inizio"))
        bpm = number(marker.get("Bpm"))
        try:
            numerator = int((marker.get("Metro") or "").split("/")[0])
            position = int(marker.get("Battito") or "")
        except ValueError:
            continue
        if start is None or bpm is None or bpm <= 0 or numerator <= 0 or position <= 0:
            continue
        parsed.append((start, original_index, bpm, numerator, position))
    parsed.sort(key=lambda item: (item[0], item[1]))
    beats: list[float] = []
    positions: list[int] = []
    for i, (start, _, bpm, numerator, position) in enumerate(parsed):
        interval = 60 / bpm
        end = duration
        if i + 1 < len(parsed):
            next_start, _, next_bpm, _, _ = parsed[i + 1]
            # Anchors are rounded to milliseconds. Extrapolating the previous
            # segment can land just before the next explicit beat anchor,
            # creating a fictitious pair of beats a few ms apart. Treat the
            # later anchor as authoritative for up to a quarter of the local
            # beat spacing (capped at 120 ms).
            boundary_guard = min(0.120, interval * 0.25, (60 / next_bpm) * 0.25)
            end = min(duration, next_start - boundary_guard)
        if start >= end or end <= 0:
            continue
        first_index = max(0, math.ceil((-start - 1e-9) / interval))
        count = max(0, math.ceil((end - start - 1e-9) / interval))
        if count - first_index > 200_000:
            raise ValueError(f"TEMPO segment would expand to more than 200,000 beats: {marker!r}")
        for step in range(first_index, count):
            beat = start + step * interval
            if beat < -1e-9 or beat >= end - 1e-9:
                continue
            if beats and beat - beats[-1] < 0.001:
                # Prefer the newer anchor if two segments meet at effectively
                # the same beat, including its Rekordbox bar phase.
                beats[-1] = max(0.0, beat)
                positions[-1] = ((position - 1 + step) % numerator) + 1
            else:
                beats.append(max(0.0, beat))
                positions.append(((position - 1 + step) % numerator) + 1)
    return beats, positions


def match_grids(
    reference: list[float],
    estimate: list[float],
    tolerance_seconds: float = TOLERANCE_SECONDS,
    *,
    include_pairs: bool = True,
) -> dict:
    """One-to-one chronological matching within the chosen timing window."""
    i = j = 0
    offsets_ms: list[float] = []
    matched_pairs: list[list[float]] = []
    while i < len(reference) and j < len(estimate):
        offset = estimate[j] - reference[i]
        if offset < -tolerance_seconds:
            j += 1
        elif offset > tolerance_seconds:
            i += 1
        else:
            offsets_ms.append(offset * 1000)
            if include_pairs:
                matched_pairs.append([reference[i], estimate[j], offset * 1000])
            i += 1
            j += 1
    matched = len(offsets_ms)
    absolute = [abs(value) for value in offsets_ms]
    result = {
        "reference_count": len(reference),
        "setvector_count": len(estimate),
        "matched_count": matched,
        "precision": matched / len(estimate) if estimate else None,
        "recall": matched / len(reference) if reference else None,
        "median_abs_error_ms": statistics.median(absolute) if absolute else None,
        "p95_abs_error_ms": percentile(absolute, 0.95),
        "median_signed_offset_ms": statistics.median(offsets_ms) if offsets_ms else None,
        "first_offset_ms": offsets_ms[0] if offsets_ms else None,
        "last_offset_ms": offsets_ms[-1] if offsets_ms else None,
    }
    if include_pairs:
        result["matched_pairs"] = matched_pairs
    return result


def artifact_json(kind: str, artifact_id: str, filename: str) -> dict:
    return json.loads((WORKSPACE / kind / artifact_id / filename).read_text(encoding="utf-8"))


def analysis_index() -> dict[str, dict]:
    if not INDEX_PATH.exists():
        return {}
    result = {}
    lines = INDEX_PATH.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.strip():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                if index == len(lines) - 1:
                    # The analyzer can still be appending this final record.
                    break
                raise
            result[record["track_id"]] = record
    return result


def build_track(index: int, element: ET.Element, analyzed: dict | None) -> dict:
    attributes = dict(element.attrib)
    track_id = attributes["TrackID"]
    markers = [dict(marker.attrib) for marker in element.findall("TEMPO")]
    cue_marks = [dict(mark.attrib) for mark in element.findall("POSITION_MARK")]
    audio_path = analyzed.get("audio_path") if analyzed else audio_path_from_uri(attributes.get("Location", ""))
    group = (
        "missing"
        if analyzed and analyzed["status"] == "missing_audio"
        else "sample"
        if "\\rekordbox\\Sampler\\" in audio_path or "/rekordbox/Sampler/" in audio_path
        else "song"
    )
    status = analyzed["status"] if analyzed else "pending_analysis"
    reference = {
        "marker_count": len(markers),
        "cue_count": len(cue_marks),
        "grid_type": "none" if not markers else "single_anchor" if len(markers) == 1 else "multiple_anchors",
        "duration_seconds": None,
        "beat_times": [],
        "bar_positions": [],
        "downbeat_times": [],
        "grid_status": "not_expanded",
    }
    setvector = {
        "source": None,
        "reliable": None,
        "tempo_bpm": None,
        "beat_times": [],
        "bar_positions": [],
        "downbeat_times": [],
        "reasons": [],
        "warnings": [],
        "quality": None,
        "grid_segments": [],
        "asset_id": None,
        "feature_id": None,
        "rhythm_id": None,
        "analysis_seconds": None,
        "error": None,
    }
    comparison = {
        "status": "pending_analysis" if not analyzed else status,
        "tolerance_ms": TOLERANCE_SECONDS * 1000,
        "secondary_tolerance_ms": SECONDARY_TOLERANCE_SECONDS * 1000,
        "beats": None,
        "downbeats": None,
        "beats_80ms": None,
        "downbeats_80ms": None,
        "bpm_difference": None,
        "bpm_abs_difference": None,
    }
    if analyzed:
        setvector["analysis_seconds"] = analyzed.get("seconds")
        setvector["error"] = analyzed.get("error")
    if status == "analyzed":
        assert analyzed is not None
        asset = artifact_json("assets", analyzed["asset_id"], "asset.json")
        feature = artifact_json("features", analyzed["feature_id"], "manifest.json")
        rhythm = artifact_json("rhythm", analyzed["rhythm_id"], "rhythm.json")
        duration = decoded_duration(asset, feature)
        reference["duration_seconds"] = duration
        if markers:
            beats, positions = marker_grid(markers, duration)
            reference.update(
                beat_times=beats,
                bar_positions=positions,
                downbeat_times=[time for time, position in zip(beats, positions) if position == 1],
                grid_status="expanded" if beats else "no_beats_within_audio",
            )
        else:
            reference["grid_status"] = "no_tempo_markers"
        bar_positions = rhythm["bar_positions"]
        setvector.update(
            source=rhythm["source"],
            reliable=rhythm["reliable"],
            tempo_bpm=rhythm["tempo_bpm"],
            beat_times=rhythm["beats"],
            bar_positions=bar_positions,
            downbeat_times=[time for time, position in zip(rhythm["beats"], bar_positions) if position == 1],
            reasons=rhythm["reasons"],
            warnings=feature["diagnostics"]["warnings"],
            quality=rhythm["quality"],
            grid_segments=rhythm["grid_segments"],
            asset_id=analyzed["asset_id"],
            feature_id=analyzed["feature_id"],
            rhythm_id=analyzed["rhythm_id"],
        )
        if not markers:
            comparison["status"] = "no_rekordbox_grid"
        elif not reference["beat_times"]:
            comparison["status"] = "no_rekordbox_beats_within_audio"
        elif not rhythm["reliable"] or not rhythm["beats"]:
            comparison["status"] = "no_reliable_setvector_grid"
        else:
            comparison.update(
                status="compared",
                beats=match_grids(reference["beat_times"], rhythm["beats"]),
                downbeats=match_grids(reference["downbeat_times"], setvector["downbeat_times"]),
                beats_80ms=match_grids(
                    reference["beat_times"], rhythm["beats"],
                    SECONDARY_TOLERANCE_SECONDS, include_pairs=False,
                ),
                downbeats_80ms=match_grids(
                    reference["downbeat_times"], setvector["downbeat_times"],
                    SECONDARY_TOLERANCE_SECONDS, include_pairs=False,
                ),
            )
            if len(markers) == 1 and rhythm["tempo_bpm"] is not None:
                xml_bpm = number(markers[0].get("Bpm"))
                if xml_bpm is not None:
                    delta = rhythm["tempo_bpm"] - xml_bpm
                    comparison["bpm_difference"] = delta
                    comparison["bpm_abs_difference"] = abs(delta)
    elif status == "missing_audio":
        comparison["status"] = "missing_audio"
    elif status == "analysis_error":
        comparison["status"] = "analysis_error"
    return {
        "index": index,
        "track_id": track_id,
        "group": group,
        "status": status,
        "audio_path": audio_path,
        "xml_attributes": attributes,
        "tempo_markers": markers,
        "cue_marks": cue_marks,
        "rekordbox": reference,
        "setvector": setvector,
        "comparison": comparison,
    }


def main() -> None:
    xml_root = ET.parse(XML_PATH).getroot()
    collection = xml_root.find("COLLECTION")
    assert collection is not None
    analyzed = analysis_index()
    tracks = [
        build_track(index, element, analyzed.get(element.attrib["TrackID"]))
        for index, element in enumerate(collection.findall("TRACK"), 1)
    ]
    statuses = Counter(track["status"] for track in tracks)
    comparison_statuses = Counter(track["comparison"]["status"] for track in tracks)
    groups = Counter(track["group"] for track in tracks)
    compared = [track for track in tracks if track["comparison"]["status"] == "compared"]
    output = {
        "schema_version": 1,
        "source": {
            "rekordbox_xml_path": str(XML_PATH),
            "rekordbox_product": dict(xml_root.find("PRODUCT").attrib),
            "declared_collection_entries": int(collection.attrib["Entries"]),
            "analysis_index_path": str(INDEX_PATH),
            "analysis_workspace_path": str(WORKSPACE),
        },
        "methods": {
            "interpretation": "Rekordbox agreement, not verified musical ground truth",
            "scope": "The comparison covers rhythm timing and BPM. Rekordbox title, artist, genre, key, cues and other XML fields are shown as metadata; this SetVector run does not infer matching fields for them.",
            "grid_expansion": "Each TEMPO is a beat anchor at Inizio. Beats advance by 60/Bpm toward the next TEMPO anchor or decoded audio end. Battito advances modulo the Metro numerator. A later anchor resets beat timing and bar phase. A predicted beat within a quarter of local beat spacing, at most 120 ms, before the next explicit anchor is suppressed as a rounded duplicate. No beats are extrapolated before the first anchor.",
            "duration": "Decoded sample count derived from SetVector feature frames, hop, frame length and omitted tail; XML TotalTime is an integer display value and asset headers may be inaccurate for MP3.",
            "matching": "Chronological one-to-one matching of SetVector and Rekordbox beats. Primary agreement uses ±40 ms and a secondary near-miss view uses ±80 ms. These timing windows are practical but arbitrary; different tolerances can change the result. Precision divides matches by SetVector beats, recall by Rekordbox beats. Offset is SetVector time minus Rekordbox time.",
            "bpm_difference": "SetVector BPM minus the sole Rekordbox TEMPO marker BPM; only reported for single-anchor tracks with a reliable SetVector grid.",
            "null_metrics": "No metric is assigned when either grid is unavailable. A SetVector abstention is a result, not a zero-accuracy measurement.",
        },
        "summary": {
            "xml_tracks": len(tracks),
            "group_counts": dict(groups),
            "analysis_status_counts": dict(statuses),
            "comparison_status_counts": dict(comparison_statuses),
            "compared_tracks": len(compared),
            "total_rekordbox_markers": sum(len(track["tempo_markers"]) for track in tracks),
            "total_cue_marks": sum(len(track["cue_marks"]) for track in tracks),
            "setvector_source_counts": dict(Counter(track["setvector"]["source"] for track in tracks if track["status"] == "analyzed")),
        },
        "tracks": tracks,
    }
    temporary = OUTPUT_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(OUTPUT_PATH)
    print(f"WROTE {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size:,} bytes)")
    print(json.dumps(output["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
