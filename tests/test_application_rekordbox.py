"""Summarizing Rekordbox exports and building Rekordbox imports."""

import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from setvector.application import build_rekordbox_import, inspect_library, load_cue_requests
from setvector.domain import ArtifactError, GridSegment, InputError
from setvector.rekordbox import (
    CapabilityProfile,
    CueRequest,
    TempoMarker,
    location_for_path,
    read_library,
)
from setvector.rekordbox import profile as profile_module
from setvector.storage import ArtifactStore

TRACK_ID_MASK = 0x7FFFFFFF

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


DROP = (CueRequest("Drop", 60.0, True),)


class FakeAnalyzer:
    """Stands in for analyze_track: returns ``rhythm`` and a path-derived asset ID."""

    def __init__(self, rhythm):
        self.rhythm = rhythm
        self.calls = []

    def __call__(self, path, config, store):
        self.calls.append(Path(path))
        asset_id = hashlib.sha256(str(path).encode()).hexdigest()
        return SimpleNamespace(asset=SimpleNamespace(asset_id=asset_id), rhythm=self.rhythm)


@pytest.fixture
def beat_this_rhythm(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    return rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 8, 1),))


@pytest.fixture
def build(tmp_path, config):
    def run(library, analyze, **options):
        options.setdefault("output", tmp_path / "out" / "setvector.xml")
        return build_rekordbox_import(
            library,
            config=config,
            store=ArtifactStore(tmp_path / "workspace"),
            analyze=analyze,
            **options,
        )

    return run


def test_existing_grid_is_copied_and_a_hot_cue_added(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio, GRID)])
    analyze = FakeAnalyzer(beat_this_rhythm)
    outcome = build(library, analyze, cues={audio: DROP}, allow_unverified=True)
    (written,) = read_library(outcome.xml_path).tracks
    assert written.track_id == 5
    assert written.tempo == (TempoMarker(0.054, 124.0, "4/4", 1),)
    assert [(mark.name, mark.slot) for mark in written.marks] == [("SV Drop", 0)]
    assert analyze.calls == []
    (record,) = outcome.receipt["tracks"]
    assert record["grid"] == {"action": "kept", "markers": 1}
    assert record["status"] == "written"
    assert outcome.receipt["unverified_override"] is True


def test_a_library_track_without_a_grid_gets_the_beat_this_grid(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio], allow_unverified=True)
    (written,) = read_library(outcome.xml_path).tracks
    assert written.tempo == (TempoMarker(0.5, 120.0, "4/4", 1),)
    assert outcome.receipt["tracks"][0]["grid"] == {
        "action": "added",
        "markers": 1,
        "source": "beat_this",
    }


def test_setvector_cues_stay_when_a_track_has_no_cue_requests(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    own = '<POSITION_MARK Name="SV Drop" Type="0" Start="2.000" Num="0"/>'
    library = library_file(tmp_path, [track_xml(5, audio, own)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio], allow_unverified=True)
    (written,) = read_library(outcome.xml_path).tracks
    assert [mark.name for mark in written.marks] == ["SV Drop"]
    assert written.tempo


def test_a_grid_without_bars_is_omitted_and_nothing_is_written(
    tmp_path, build, report_inputs, rhythm_factory
):
    _, bundle = report_inputs()
    fallback = rhythm_factory(bundle, source="setvector_fallback")
    outcome = build(library_file(tmp_path, []), FakeAnalyzer(fallback), add=[audio_file(tmp_path)])
    assert outcome.written_count == 0
    (record,) = outcome.receipt["tracks"]
    assert record["status"] == "unchanged"
    assert record["grid"]["action"] == "omitted"
    assert "setvector_fallback" in record["grid"]["reasons"][0]
    assert read_library(outcome.xml_path).tracks == ()


def test_a_new_track_gets_a_free_id_location_name_and_bpm(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path, "New Track #1.mp3")
    digest = hashlib.sha256(str(audio.absolute()).encode()).hexdigest()
    taken = int(digest[:8], 16) & TRACK_ID_MASK or 1
    library = library_file(tmp_path, [track_xml(taken, audio_file(tmp_path, "Other.mp3"), GRID)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    (written,) = read_library(outcome.xml_path).tracks
    assert written.track_id == taken + 1
    assert written.location == location_for_path(audio.absolute())
    assert written.attribute("Name") == "New Track #1"
    assert written.attribute("AverageBpm") == "120.00"
    assert outcome.receipt["unverified_override"] is False


def test_an_added_path_collapses_dot_dot_segments(tmp_path, build, beat_this_rhythm):
    audio_file(tmp_path, "A.mp3")
    messy = tmp_path / "music" / ".." / "music" / "A.mp3"
    library = library_file(tmp_path, [])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[messy])
    (written,) = read_library(outcome.xml_path).tracks
    assert ".." not in written.location
    assert written.location == location_for_path(Path(os.path.abspath(messy)))


def test_changing_a_library_track_needs_a_verified_version(
    tmp_path, build, beat_this_rhythm, monkeypatch
):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio, GRID)])
    with pytest.raises(InputError, match="rekordbox_probe"):
        build(library, FakeAnalyzer(beat_this_rhythm), cues={audio: DROP})
    assert not (tmp_path / "out").exists()
    measured = CapabilityProfile(("7.2.19",), 8, 10, True, "replace", True)
    monkeypatch.setattr(profile_module, "PROFILES", (measured,))
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), cues={audio: DROP})
    assert outcome.receipt["profile_verified"] is True
    assert outcome.receipt["unverified_override"] is False


def test_changing_a_library_tracks_grid_needs_a_verified_version(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio)])
    with pytest.raises(InputError, match="rekordbox_probe"):
        build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])


def test_cue_requests_must_name_a_known_file(tmp_path, build, beat_this_rhythm):
    with pytest.raises(InputError, match="neither in the library nor added"):
        build(
            library_file(tmp_path, []),
            FakeAnalyzer(beat_this_rhythm),
            cues={tmp_path / "x.mp3": DROP},
        )


def test_an_added_file_must_exist(tmp_path, build, beat_this_rhythm):
    with pytest.raises(InputError, match="not found"):
        build(
            library_file(tmp_path, []), FakeAnalyzer(beat_this_rhythm), add=[tmp_path / "gone.mp3"]
        )


def test_adding_a_library_track_whose_file_is_missing_omits_its_grid(
    tmp_path, build, beat_this_rhythm
):
    missing = tmp_path / "music" / "gone.mp3"
    library = library_file(tmp_path, [track_xml(5, missing)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[missing])
    assert outcome.written_count == 0
    (record,) = outcome.receipt["tracks"]
    assert record["status"] == "unchanged"
    assert record["grid"] == {"action": "omitted", "reasons": ["audio file not found"]}


def test_output_cannot_overwrite_the_library(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio, GRID)])
    original = library.read_bytes()
    with pytest.raises(InputError, match="would overwrite"):
        build(
            library,
            FakeAnalyzer(beat_this_rhythm),
            cues={audio: DROP},
            allow_unverified=True,
            output=library,
            overwrite=True,
        )
    assert library.read_bytes() == original


def test_duplicate_library_records_are_skipped_when_only_added(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio), track_xml(6, audio)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    assert outcome.written_count == 0
    (record,) = outcome.receipt["tracks"]
    assert record["status"] == "skipped"
    assert record["in_library"] is True
    assert record["track_id"] is None
    assert record["grid"] == {
        "action": "omitted",
        "reasons": ["several library records for this file"],
    }
    assert record["cues"] == []
    assert record["reason"] == "several library records for this file"


def test_duplicate_library_records_with_cues_are_rejected(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [track_xml(5, audio), track_xml(6, audio)])
    with pytest.raises(InputError, match="several library records point to"):
        build(library, FakeAnalyzer(beat_this_rhythm), cues={audio: DROP}, allow_unverified=True)


def test_a_failed_receipt_write_leaves_no_output(tmp_path, build, beat_this_rhythm, monkeypatch):
    import setvector.application.rekordbox as rekordbox_module

    real_write_file = rekordbox_module.write_file

    def flaky_write_file(path, data, *, overwrite=False, kind="file"):
        if kind == "receipt":
            raise ArtifactError("boom")
        return real_write_file(path, data, overwrite=overwrite, kind=kind)

    monkeypatch.setattr(rekordbox_module, "write_file", flaky_write_file)
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [])
    with pytest.raises(ArtifactError):
        build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    assert not (tmp_path / "out" / "setvector.xml").exists()
    assert not (tmp_path / "out" / "setvector.xml.receipt.json").exists()


def test_a_failed_stale_receipt_removal_rolls_back_the_xml(
    tmp_path, build, beat_this_rhythm, monkeypatch
):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [])
    first = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    assert first.xml_path.exists()
    assert first.receipt_path.exists()
    real_unlink = Path.unlink

    def flaky_unlink(self, missing_ok=False):
        if self.name == first.receipt_path.name:
            raise PermissionError("boom")
        return real_unlink(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", flaky_unlink)
    with pytest.raises(ArtifactError, match="cannot replace receipt"):
        build(library, FakeAnalyzer(beat_this_rhythm), add=[audio], overwrite=True)
    assert not first.xml_path.exists()


def test_new_track_guards_against_a_missing_asset_id(tmp_path):
    from setvector.application.rekordbox import _new_track

    audio = audio_file(tmp_path)
    with pytest.raises(InputError, match="audio file disappeared"):
        _new_track(audio, None, None, (), (), set())


def test_a_library_location_with_a_null_byte_is_treated_as_non_file(
    tmp_path, build, beat_this_rhythm
):
    bad_location = '<TRACK TrackID="5" Name="Bad" Location="file://localhost/C:/bad%00name.mp3"/>'
    library = library_file(tmp_path, [bad_location])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio_file(tmp_path)])
    assert outcome.written_count == 1


def test_existing_output_needs_overwrite(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    library = library_file(tmp_path, [])
    first = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    with pytest.raises(InputError, match="already exists"):
        build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    again = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio], overwrite=True)
    assert again.xml_path == first.xml_path
    assert first.receipt_path.name == "setvector.xml.receipt.json"
    assert json.loads(first.receipt_path.read_text(encoding="utf-8"))["written_count"] == 1


def test_cues_that_do_not_fit_are_reported(tmp_path, build, beat_this_rhythm):
    audio = audio_file(tmp_path)
    user = "".join(f'<POSITION_MARK Name="" Type="0" Start="{i}.000" Num="{i}"/>' for i in range(8))
    library = library_file(tmp_path, [track_xml(5, audio, GRID + user)])
    outcome = build(
        library, FakeAnalyzer(beat_this_rhythm), cues={audio: DROP}, allow_unverified=True
    )
    (record,) = outcome.receipt["tracks"]
    assert record["status"] == "unchanged"
    assert record["cues"] == [
        {
            "label": "Drop",
            "hot": True,
            "start_seconds": 60.0,
            "status": "no_free_slot",
            "slot": None,
        }
    ]


def test_rerunning_the_same_cues_after_rekordbox_export_order_is_unchanged(
    tmp_path, build, beat_this_rhythm
):
    audio = audio_file(tmp_path)
    sv_intro = '<POSITION_MARK Name="SV Intro" Type="0" Start="5.000" Num="-1"/>'
    user_hot = '<POSITION_MARK Name="" Type="0" Start="10.000" Num="0"/>'
    library = library_file(tmp_path, [track_xml(5, audio, GRID + sv_intro + user_hot)])
    requests = (CueRequest("Intro", 5.0, False),)
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), cues={audio: requests})
    assert outcome.written_count == 0
    (record,) = outcome.receipt["tracks"]
    assert record["status"] == "unchanged"


def test_receipt_records_limits_allow_unverified_hash_and_removed_cues(
    tmp_path, build, beat_this_rhythm
):
    audio = audio_file(tmp_path)
    old = '<POSITION_MARK Name="SV Old" Type="0" Start="2.000" Num="0"/>'
    library = library_file(tmp_path, [track_xml(5, audio, GRID + old)])
    outcome = build(
        library, FakeAnalyzer(beat_this_rhythm), cues={audio: DROP}, allow_unverified=True
    )
    assert outcome.receipt["allow_unverified"] is True
    assert outcome.receipt["cue_limits"] == {"hot_cue_slots": 8, "memory_cue_limit": 10}
    assert outcome.receipt["library_sha256"] == hashlib.sha256(library.read_bytes()).hexdigest()
    (record,) = outcome.receipt["tracks"]
    assert record["removed_setvector_cues"] == ["SV Old"]


def test_load_cue_requests(tmp_path):
    path = tmp_path / "cues.json"
    entry = {
        "path": "C:/Music/a.mp3",
        "cues": [{"label": "Drop", "start_seconds": 60, "hot": True}],
    }
    path.write_text(json.dumps({"tracks": [entry]}), encoding="utf-8")
    assert load_cue_requests(path) == {Path("C:/Music/a.mp3"): DROP}
    path.write_text(
        json.dumps({"tracks": [{"path": "a.mp3", "cues": [{"label": "Drop"}]}]}), encoding="utf-8"
    )
    with pytest.raises(InputError, match="track 1: missing fields"):
        load_cue_requests(path)


def test_load_cue_requests_rejects_duplicate_paths(tmp_path):
    path = tmp_path / "cues.json"
    entry = {"label": "Drop", "start_seconds": 60, "hot": True}
    path.write_text(
        json.dumps(
            {
                "tracks": [
                    {"path": "a.mp3", "cues": [entry]},
                    {"path": "a.mp3", "cues": [entry]},
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(InputError, match="names a.mp3 twice"):
        load_cue_requests(path)


def test_load_cue_requests_resolves_relative_paths(tmp_path):
    folder = tmp_path / "exports"
    folder.mkdir()
    path = folder / "cues.json"
    entry = {"path": "audio.mp3", "cues": [{"label": "Drop", "start_seconds": 60, "hot": True}]}
    path.write_text(json.dumps({"tracks": [entry]}), encoding="utf-8")
    assert load_cue_requests(path) == {folder / "audio.mp3": DROP}
