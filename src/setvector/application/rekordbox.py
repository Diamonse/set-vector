"""Rekordbox exchange: summarize a collection export and build an import file."""

from collections import Counter
from pathlib import Path

from setvector.rekordbox import profile_for, read_library


def _is_file(path: Path) -> bool:
    """Whether ``path`` is a readable local file; unreachable drives count as missing."""
    try:
        return path.is_file()
    except OSError:
        return False


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
