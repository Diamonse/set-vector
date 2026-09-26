"""Summarizing Rekordbox exports and building Rekordbox imports."""

from pathlib import Path

from setvector.application import inspect_library
from setvector.rekordbox import location_for_path

GRID = '<TEMPO Inizio="0.054" Bpm="124.00" Metro="4/4" Battito="1"/>'


def audio_file(tmp_path, name="Track One.mp3"):
    path = tmp_path / "music" / name
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b"not decoded by these tests")
    return path


def library_file(tmp_path, tracks, version="7.2.19"):
    path = tmp_path / "collection.xml"
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">'
        f'<PRODUCT Name="rekordbox" Version="{version}" Company="AlphaTheta"/>'
        f'<COLLECTION Entries="{len(tracks)}">{"".join(tracks)}</COLLECTION></DJ_PLAYLISTS>',
        encoding="utf-8",
    )
    return path


def track_xml(track_id, audio, children=""):
    location = location_for_path(audio)
    return (
        f'<TRACK TrackID="{track_id}" Name="{audio.stem}" Location="{location}">{children}</TRACK>'
    )


def test_inspect_summarizes_locations_grids_and_cues(tmp_path):
    present = audio_file(tmp_path)
    missing = tmp_path / "music" / "gone.mp3"
    memory = '<POSITION_MARK Name="" Type="0" Start="1.000" Num="-1"/>'
    own = '<POSITION_MARK Name="SV Drop" Type="0" Start="2.000" Num="0"/>'
    library = library_file(
        tmp_path,
        [
            track_xml(1, present, GRID + memory + own),
            track_xml(2, missing, GRID + GRID.replace("0.054", "60.054")),
            '<TRACK TrackID="3" Location="file://localhost/soundcloud:tracks:1"/>',
        ],
    )
    assert inspect_library(library) == {
        "product": {"name": "rekordbox", "version": "7.2.19"},
        "track_count": 3,
        "locations": {"file_present": 1, "file_missing": 1, "non_file": 1},
        "grids": {"none": 1, "single_marker": 1, "multiple_markers": 1},
        "meters": {"4/4": 3},
        "hot_cues": 1,
        "memory_cues": 1,
        "setvector_cues": 1,
        "profile_verified": False,
    }


def test_inspect_treats_an_unreachable_drive_as_missing(tmp_path, monkeypatch):
    unreachable = audio_file(tmp_path, name="Unreachable.mp3")
    library = library_file(tmp_path, [track_xml(1, unreachable)])
    real_is_file = Path.is_file

    def flaky_is_file(self):
        if self.name == "Unreachable.mp3":
            raise PermissionError("network path is unreachable")
        return real_is_file(self)

    monkeypatch.setattr(Path, "is_file", flaky_is_file)

    summary = inspect_library(library)

    assert summary["locations"] == {"file_present": 0, "file_missing": 1, "non_file": 0}
