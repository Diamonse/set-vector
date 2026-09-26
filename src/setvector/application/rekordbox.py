"""Rekordbox exchange: summarize a collection export and build an import file."""

import hashlib
import json
import os
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from setvector.domain import AnalysisConfig, ArtifactError, InputError, RhythmAnalysis
from setvector.rekordbox import (
    CapabilityProfile,
    CueOutcome,
    CueRequest,
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    location_for_path,
    parse_library,
    place_cues,
    profile_for,
    read_library,
    render_library,
    tempo_markers_for,
)
from setvector.storage import ArtifactStore, strict_json_loads, write_file

from .analyze import analyze_track

_PROBE_HINT = "run scripts/rekordbox_probe.py to qualify it, or pass --unverified-rekordbox"
_TRACK_ID_MASK = 0x7FFFFFFF


def _is_file(path: Path) -> bool:
    """Whether ``path`` is a readable local file; unreachable drives count as missing."""
    try:
        return path.is_file()
    except OSError:
        return False


def _key(path: str | Path) -> str | None:
    """Return a normalized identity key for ``path``, or ``None`` if it cannot be resolved.

    A location decoded from odd Rekordbox XML (an embedded null byte, an unreachable
    drive) can raise ``OSError`` or ``ValueError`` when resolved; callers treat ``None``
    as a file that cannot be matched.
    """
    try:
        return os.path.normcase(str(Path(path).resolve()))
    except (OSError, ValueError):
        return None


def inspect_library(xml_path: str | Path) -> dict[str, object]:
    """Summarize a collection export's locations, grids and cues without reading audio."""
    library = read_library(xml_path)
    locations: Counter[str] = Counter()
    grids: Counter[str] = Counter()
    meters: Counter[str] = Counter()
    for track in library.tracks:
        path = track.path
        if path is None:
            locations["non_file"] += 1
        else:
            locations["file_present" if _is_file(path) else "file_missing"] += 1
        if not track.tempo:
            grids["none"] += 1
        else:
            grids["single_marker" if len(track.tempo) == 1 else "multiple_markers"] += 1
        meters.update(marker.meter for marker in track.tempo)
    marks = [mark for track in library.tracks for mark in track.marks]
    return {
        "product": {"name": library.product_name, "version": library.product_version},
        "track_count": len(library.tracks),
        "locations": {key: locations[key] for key in ("file_present", "file_missing", "non_file")},
        "grids": {key: grids[key] for key in ("none", "single_marker", "multiple_markers")},
        "meters": dict(sorted(meters.items())),
        "hot_cues": sum(mark.slot is not None for mark in marks),
        "memory_cues": sum(mark.slot is None for mark in marks),
        "setvector_cues": sum(mark.is_setvector for mark in marks),
        "profile_verified": profile_for(library.product_version).verified,
    }


@dataclass(frozen=True, slots=True)
class RekordboxExportOutcome:
    """Where the import file and its receipt were written, and what they record."""

    xml_path: Path
    receipt_path: Path
    written_count: int
    receipt: Mapping[str, object]


def load_cue_requests(path: str | Path) -> dict[Path, tuple[CueRequest, ...]]:
    """Read ``{"tracks": [{"path": ..., "cues": [...]}]}`` cue requests from JSON.

    A relative ``path`` is resolved against the folder holding this JSON file; an
    absolute one is kept as written. The same ``path`` text must not name two tracks.
    """
    json_path = Path(path)
    try:
        data = strict_json_loads(json_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise InputError(f"cannot read cue requests {path}: {error}") from error
    if (
        not isinstance(data, dict)
        or set(data) != {"tracks"}
        or not isinstance(data["tracks"], list)
    ):
        raise InputError(f"{path} must be an object with a tracks array")
    base = json_path.parent
    seen: set[str] = set()
    requests: dict[Path, tuple[CueRequest, ...]] = {}
    for index, entry in enumerate(data["tracks"], 1):
        try:
            if (
                not isinstance(entry, dict)
                or set(entry) != {"path", "cues"}
                or not isinstance(entry["path"], str)
                or not isinstance(entry["cues"], list)
            ):
                raise ValueError("each track needs a path and a cues array")
            raw_path = entry["path"]
            if raw_path in seen:
                raise ValueError(f"names {raw_path} twice")
            seen.add(raw_path)
            entry_path = Path(raw_path)
            if not entry_path.is_absolute():
                entry_path = base / entry_path
            requests[entry_path] = tuple(CueRequest.from_dict(c) for c in entry["cues"])
        except ValueError as error:
            raise InputError(f"{path}: track {index}: {error}") from error
    return requests


def build_rekordbox_import(
    library_path: str | Path | None,
    *,
    config: AnalysisConfig,
    store: ArtifactStore,
    output: str | Path,
    add: Sequence[str | Path] = (),
    cues: Mapping[str | Path, Sequence[CueRequest]] | None = None,
    allow_unverified: bool = False,
    overwrite: bool = False,
    profile: CapabilityProfile | None = None,
    playlist_name: str = "SetVector",
    analyze: Callable = analyze_track,
) -> RekordboxExportOutcome:
    """Write Rekordbox XML holding the full new state of every track SetVector changes.

    Library tracks named by ``add`` or ``cues`` and new files in ``add`` are considered.
    Existing grids and user cues are copied unchanged; a grid is added only to a track
    without one. A track with cue requests has all of its SetVector cues replaced. Changing
    a library track needs a qualified Rekordbox version or ``allow_unverified``. ``profile``
    overrides cue limits only.

    The output and receipt paths must not coincide with the library file, an added file, or
    a selected library track's file. Several library records naming the same file are
    ambiguous: rejected outright if cue requests target that file, otherwise skipped. The
    XML is written before the receipt; a failed receipt write removes the XML so neither is
    left behind. A JSON receipt recording every decision is written next to the XML.
    """
    xml_target = Path(output).resolve()
    receipt_target = xml_target.with_name(xml_target.name + ".receipt.json")
    for target in (xml_target, receipt_target):
        if target.is_dir():
            raise InputError(f"output path is a directory: {target}")
        if target.exists() and not overwrite:
            raise InputError(f"{target} already exists; pass --overwrite to replace it")
    library_bytes: bytes | None = None
    if library_path is not None:
        library_source = Path(library_path)
        try:
            library_bytes = library_source.read_bytes()
        except OSError as error:
            raise InputError(f"cannot read Rekordbox XML {library_source}: {error}") from error
        library = parse_library(library_bytes, str(library_source))
    else:
        library = RekordboxLibrary(None, None, ())
    version_profile = profile_for(library.product_version)
    limits = profile or version_profile
    in_library: dict[str, list[RekordboxTrack]] = {}
    for track in library.tracks:
        if track.path is None:
            continue
        key = _key(track.path)
        if key is None:
            continue
        in_library.setdefault(key, []).append(track)
    added: dict[str, Path] = {}
    for item in add:
        absolute = Path(os.path.abspath(item))
        key = _key(absolute)
        if key is None:
            raise InputError(f"cannot resolve added audio file: {absolute}")
        if key not in in_library and not _is_file(absolute):
            raise InputError(f"added audio file not found: {absolute}")
        added.setdefault(key, absolute)
    requests: dict[str, tuple[CueRequest, ...]] = {}
    for item, items in (cues or {}).items():
        key = _key(item)
        if key is None or (key not in in_library and key not in added):
            raise InputError(
                f"cue requests name a file that is neither in the library nor added: {item}"
            )
        if key in requests:
            raise InputError(f"cue requests name {item} twice")
        requests[key] = tuple(items)
    _guard_output_targets(xml_target, receipt_target, library_path, added, in_library, requests)
    selected, records = _select_tracks(in_library, added, requests)
    used_ids = {track.track_id for track in library.tracks}
    written: list[RekordboxTrack] = []
    for key, track in selected:
        path = track.path.resolve() if track is not None else added[key]
        record, result = _process(
            path,
            track,
            requests.get(key),
            limits,
            used_ids,
            lambda audio: analyze(audio, config, store),
        )
        records.append(record)
        if result is not None:
            written.append(result)
    changed_library_tracks = [r for r in records if r["in_library"] and r["status"] == "written"]
    if changed_library_tracks and not version_profile.verified and not allow_unverified:
        version = library.product_version or "of unknown version"
        raise InputError(
            f"Rekordbox {version} has not been qualified for updating tracks already in the "
            f"collection; {_PROBE_HINT}"
        )
    data = render_library(written, playlist_name)
    receipt = {
        "library": str(Path(library_path).resolve()) if library_path is not None else None,
        "library_sha256": _library_sha256(library_bytes),
        "rekordbox_version": library.product_version,
        "profile_verified": version_profile.verified,
        "allow_unverified": allow_unverified,
        "unverified_override": bool(changed_library_tracks) and not version_profile.verified,
        "cue_limits": {
            "hot_cue_slots": limits.hot_cue_slots,
            "memory_cue_limit": limits.memory_cue_limit,
        },
        "output": str(xml_target),
        "written_count": len(written),
        "tracks": records,
    }
    text = json.dumps(receipt, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    xml_path = write_file(xml_target, data, overwrite=overwrite, kind="Rekordbox XML")
    if overwrite and receipt_target.exists():
        try:
            receipt_target.unlink()
        except OSError as error:
            _unlink_quietly(xml_path)
            raise ArtifactError(f"cannot replace receipt {receipt_target}: {error}") from error
    try:
        receipt_path = write_file(
            receipt_target, text.encode("utf-8"), overwrite=overwrite, kind="receipt"
        )
    except BaseException:
        _unlink_quietly(xml_path)
        raise
    return RekordboxExportOutcome(xml_path, receipt_path, len(written), receipt)


def _unlink_quietly(path: Path) -> None:
    """Best-effort cleanup: never let a failed unlink mask the error already being raised."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _guard_output_targets(
    xml_target: Path,
    receipt_target: Path,
    library_path: str | Path | None,
    added: Mapping[str, Path],
    in_library: Mapping[str, Sequence[RekordboxTrack]],
    requests: Mapping[str, tuple[CueRequest, ...]],
) -> None:
    """Raise ``InputError`` if the output or receipt path would overwrite an input file."""
    protected: dict[str, Path] = {}
    if library_path is not None:
        resolved = Path(library_path).resolve()
        key = _key(resolved)
        if key is not None:
            protected[key] = resolved
    protected.update(added)
    for key, tracks in in_library.items():
        if key in added or key in requests:
            protected.setdefault(key, tracks[0].path.resolve())
    for target in (xml_target, receipt_target):
        key = _key(target)
        if key is not None and key in protected:
            raise InputError(f"output would overwrite {protected[key]}")


def _select_tracks(
    in_library: Mapping[str, list[RekordboxTrack]],
    added: Mapping[str, Path],
    requests: Mapping[str, tuple[CueRequest, ...]],
) -> tuple[list[tuple[str, RekordboxTrack | None]], list[dict[str, object]]]:
    """Return tracks to process, and receipt records for ambiguous duplicates skipped outright.

    A key naming more than one library record is ambiguous: it is rejected if cue requests
    target it, otherwise skipped without being written.
    """
    selected: list[tuple[str, RekordboxTrack | None]] = []
    skipped: list[dict[str, object]] = []
    for key, tracks in in_library.items():
        if key not in added and key not in requests:
            continue
        if len(tracks) > 1:
            if key in requests:
                raise InputError(
                    f"several library records point to {tracks[0].path.resolve()}; remove the "
                    "duplicates in Rekordbox first"
                )
            skipped.append(
                {
                    "path": str(tracks[0].path.resolve()),
                    "in_library": True,
                    "track_id": None,
                    "grid": {
                        "action": "omitted",
                        "reasons": ["several library records for this file"],
                    },
                    "cues": [],
                    "status": "skipped",
                    "reason": "several library records for this file",
                }
            )
            continue
        selected.append((key, tracks[0]))
    selected += [(key, None) for key in added if key not in in_library]
    return selected, skipped


def _library_sha256(data: bytes | None) -> str | None:
    """Return the SHA-256 of the already-read library bytes, or ``None`` without a library."""
    if data is None:
        return None
    return hashlib.sha256(data).hexdigest()


def _process(
    path: Path,
    track: RekordboxTrack | None,
    requests: tuple[CueRequest, ...] | None,
    limits: CapabilityProfile,
    used_ids: set[int],
    analyze: Callable[[Path], object],
) -> tuple[dict[str, object], RekordboxTrack | None]:
    record: dict[str, object] = {"path": str(path), "in_library": track is not None}
    tempo = track.tempo if track is not None else ()
    marks = track.marks if track is not None else ()
    asset_id = bpm = None
    if tempo:
        record["grid"] = {"action": "kept", "markers": len(tempo)}
    elif not _is_file(path):
        record["grid"] = {"action": "omitted", "reasons": ["audio file not found"]}
    else:
        outcome = analyze(path)
        asset_id = outcome.asset.asset_id
        tempo, record["grid"] = _grid(outcome.rhythm)
        bpm = outcome.rhythm.tempo_bpm if tempo else None
    if requests is None:
        final_marks, record["cues"] = marks, []
    else:
        placement = place_cues(marks, requests, limits)
        final_marks = placement.marks
        record["cues"] = [_cue_record(item) for item in placement.outcomes]
        previous_sv = {mark.name for mark in marks if mark.is_setvector}
        final_sv = {mark.name for mark in final_marks if mark.is_setvector}
        record["removed_setvector_cues"] = sorted(previous_sv - final_sv)
    result = None
    if track is not None:
        if tempo != track.tempo or final_marks != track.marks:
            result = replace(track, tempo=tempo, marks=final_marks)
    elif tempo or final_marks:
        result = _new_track(path, asset_id, bpm, tempo, final_marks, used_ids)
    if result is not None:
        record["track_id"] = result.track_id
    else:
        record["track_id"] = track.track_id if track is not None else None
    record["status"] = "written" if result is not None else "unchanged"
    return record, result


def _grid(rhythm: RhythmAnalysis) -> tuple[tuple[TempoMarker, ...], dict[str, object]]:
    if rhythm.source != "beat_this":
        reasons = [f"no bar grid from rhythm source {rhythm.source}", *rhythm.reasons]
        return (), {"action": "omitted", "reasons": reasons}
    try:
        markers = tempo_markers_for(rhythm)
    except ValueError as error:
        return (), {"action": "omitted", "reasons": [str(error)]}
    return markers, {"action": "added", "markers": len(markers), "source": "beat_this"}


def _new_track(
    path: Path,
    asset_id: str | None,
    bpm: float | None,
    tempo: tuple[TempoMarker, ...],
    marks: tuple[PositionMark, ...],
    used_ids: set[int],
) -> RekordboxTrack:
    if asset_id is None:
        raise InputError(f"audio file disappeared: {path}")
    track_id = int(asset_id[:8], 16) & _TRACK_ID_MASK or 1
    while track_id in used_ids:
        track_id = track_id % _TRACK_ID_MASK + 1
    used_ids.add(track_id)
    attributes = [("Name", path.stem)]
    if bpm is not None:
        attributes.append(("AverageBpm", f"{bpm:.2f}"))
    return RekordboxTrack(track_id, location_for_path(path), tuple(attributes), tempo, marks)


def _cue_record(outcome: CueOutcome) -> dict[str, object]:
    request = outcome.request
    return {
        "label": request.label,
        "hot": request.hot,
        "start_seconds": request.start_seconds,
        "status": outcome.status,
        "slot": outcome.slot,
    }
