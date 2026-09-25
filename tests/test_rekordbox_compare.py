"""Findings describe what Rekordbox kept, rounded, changed, dropped or duplicated."""

from dataclasses import replace

from setvector.rekordbox import (
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    compare_libraries,
    compare_track,
)

LOCATION = "file://localhost/C:/Probe/probe-1.wav"
GRID = (TempoMarker(0.5, 120.0, "4/4", 1),)
HOT_A = PositionMark("SV Hot A", "cue", 1.0, slot=0, colour=(255, 0, 0))
MEMORY = PositionMark("SV Mem 01", "cue", 2.0)


def track(marks=(), tempo=GRID, location=LOCATION, track_id=1):
    return RekordboxTrack(track_id, location, (("Name", "probe-1"),), tempo, marks)


def library(*tracks):
    return RekordboxLibrary("rekordbox", "7.2.19", tracks)


def results(expected, actual):
    return {
        (f["item"], f["result"]) for f in compare_libraries(library(expected), library(*actual))
    }


def test_identical_tracks_are_kept():
    assert results(track((HOT_A, MEMORY)), [track((HOT_A, MEMORY))]) == {
        ("tempo 1", "kept"),
        ("hot A", "kept"),
        ("memory SV Mem 01", "kept"),
    }


def test_small_shifts_are_rounded_and_large_ones_changed():
    moved = track((replace(HOT_A, start_seconds=1.003), replace(MEMORY, start_seconds=2.1)))
    found = results(track((HOT_A, MEMORY)), [moved])
    assert {("hot A", "rounded"), ("memory SV Mem 01", "changed")} <= found


def test_missing_duplicated_and_extra_marks():
    user = PositionMark("", "cue", 5.0, slot=6)
    actual = track((HOT_A, replace(HOT_A, start_seconds=1.5), user))
    found = results(track((HOT_A, MEMORY)), [actual])
    assert {("hot A", "duplicated"), ("memory SV Mem 01", "missing"), ("hot G", "extra")} <= found


def test_colour_and_grid_changes_are_reported():
    actual = track(
        (replace(HOT_A, colour=(250, 0, 0)),), tempo=(TempoMarker(0.5, 121.0, "4/4", 1),)
    )
    findings = compare_libraries(library(track((HOT_A,))), library(actual))
    changed = {f["item"]: f["detail"] for f in findings if f["result"] == "changed"}
    assert "colour (250, 0, 0)" in changed["hot A"]
    assert "121.00" in changed["tempo 1"]


def test_missing_and_duplicated_tracks():
    assert ("track", "missing") in results(track(), [])
    assert ("track", "duplicated") in results(track(), [track(), track(track_id=2)])


def test_tracks_match_by_decoded_path_not_location_text():
    reencoded = track(location="file://localhost/C:/Probe/probe%2D1.wav")
    assert ("track", "missing") not in results(track(), [reencoded])


def test_two_marks_with_the_same_name_are_matched_individually():
    buildup_a = PositionMark("SV Buildup", "cue", 10.0)
    buildup_b = PositionMark("SV Buildup", "cue", 40.0)
    expected = track((buildup_a, buildup_b))
    actual = track((buildup_a, buildup_b))
    marks = [row for row in compare_track(expected, actual) if row[0] != "tempo 1"]
    assert marks == [
        ("memory SV Buildup", "kept", "+0.0 ms"),
        ("memory SV Buildup", "kept", "+0.0 ms"),
    ]


def test_inserted_tempo_marker_does_not_misalign_later_ones():
    expected = track(tempo=(TempoMarker(0.0, 120.0, "4/4", 1), TempoMarker(8.0, 128.0, "4/4", 1)))
    actual = track(
        tempo=(
            TempoMarker(0.0, 120.0, "4/4", 1),
            TempoMarker(4.0, 120.0, "4/4", 1),
            TempoMarker(8.0, 128.0, "4/4", 1),
        )
    )
    findings = compare_track(expected, actual)
    assert ("tempo 1", "kept", "+0.0 ms") in findings
    assert ("tempo 2", "kept", "+0.0 ms") in findings
    assert ("tempo at 4.000 s", "extra", "120.00 BPM") in findings


def test_unnamed_memory_cue_drift_is_changed_not_missing():
    want = PositionMark("", "cue", 12.0)
    got = PositionMark("", "cue", 12.02)
    findings = compare_track(track((want,)), track((got,)))
    marks = [row for row in findings if row[0] != "tempo 1"]
    assert marks == [("memory 12.000", "changed", "start 12.020")]


def test_close_duplicate_is_reported_but_unrelated_mark_stays_extra():
    want = PositionMark("", "cue", 12.0)
    exact = PositionMark("", "cue", 12.000)
    close = PositionMark("", "cue", 12.001)
    unrelated = PositionMark("", "cue", 30.0)
    findings = compare_track(track((want,)), track((exact, close, unrelated)))
    marks = [row for row in findings if row[0] != "tempo 1"]
    assert marks == [
        ("memory 12.000", "kept", "+0.0 ms"),
        ("memory 12.000", "duplicated", "1 extra copy"),
        ("memory 30.000", "extra", "cue at 30.000 s"),
    ]


def test_distant_unnamed_mark_is_missing_and_extra_not_changed():
    want = PositionMark("", "cue", 12.0)
    got = PositionMark("", "cue", 45.0)
    findings = compare_track(track((want,)), track((got,)))
    marks = [row for row in findings if row[0] != "tempo 1"]
    assert marks == [
        ("memory 12.000", "missing", ""),
        ("memory 45.000", "extra", "cue at 45.000 s"),
    ]
