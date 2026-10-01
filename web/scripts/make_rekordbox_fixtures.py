"""Generate parity fixtures for the browser Rekordbox reader from the CLI's own code.

Run from the repository root with the CLI installed:

    PYTHONPATH=src python web/scripts/make_rekordbox_fixtures.py

Reads the repository's test collection and expands synthetic tempo maps, so no personal
library is committed.
"""

import json
from pathlib import Path

from setvector.rekordbox.grid import expand_tempo
from setvector.rekordbox.model import TempoMarker, path_from_location
from setvector.rekordbox.read import read_library

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "tests" / "fixtures" / "rekordbox"

SYNTHETIC = {
    "single": ([(0.054, 124.0, "4/4", 1)], 360.0),
    "two_tempos": ([(0.051, 123.0, "4/4", 3), (120.051, 126.0, "4/4", 1)], 300.0),
    "unsorted_three_four": ([(10.0, 90.0, "3/4", 2), (0.5, 90.0, "3/4", 1)], 40.0),
    "close_markers": ([(1.0, 128.0, "4/4", 1), (1.05, 128.0, "4/4", 4), (30.0, 140.0, "4/4", 1)], 60.0),
    "rounded_anchor": ([(0.0, 120.0, "4/4", 1), (2.0004, 120.0, "4/4", 1)], 5.0),
    "past_end": ([(0.0, 100.0, "4/4", 1), (50.0, 100.0, "4/4", 1)], 20.0),
    "odd_meter": ([(0.25, 174.0, "7/8", 5)], 12.0),
}


def marker_json(marker: TempoMarker) -> dict:
    return {
        "startSeconds": marker.start_seconds,
        "bpm": marker.bpm,
        "meter": marker.meter,
        "beatInBar": marker.beat_in_bar,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    library = read_library(ROOT / "tests" / "data" / "rekordbox-collection.xml")
    tracks = []
    for track in library.tracks:
        path = path_from_location(track.location)
        duration = track.attribute("TotalTime")
        expanded = expand_tempo(track.tempo, float(duration)) if duration and track.tempo else None
        tracks.append(
            {
                "trackId": track.track_id,
                "location": track.location,
                "path": path.as_posix() if path is not None else None,
                "attributes": dict(track.attributes),
                "tempo": [marker_json(m) for m in track.tempo],
                "marks": [
                    {
                        "name": m.name,
                        "kind": m.kind,
                        "startSeconds": m.start_seconds,
                        "endSeconds": m.end_seconds,
                        "slot": m.slot,
                        "colour": list(m.colour) if m.colour else None,
                    }
                    for m in track.marks
                ],
                "grid": {"beats": list(expanded[0]), "positions": list(expanded[1])} if expanded else None,
            }
        )
    grids = {}
    for name, (raw, duration) in SYNTHETIC.items():
        markers = [TempoMarker(*m) for m in raw]
        beats, positions = expand_tempo(markers, duration)
        grids[name] = {
            "markers": [marker_json(m) for m in markers],
            "duration": duration,
            "beats": list(beats),
            "positions": list(positions),
        }
    document = {
        "productName": library.product_name,
        "productVersion": library.product_version,
        "tracks": tracks,
        "grids": grids,
    }
    (OUT / "collection.json").write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
