"""Validated Rekordbox records and the file URIs Rekordbox uses for locations."""

from pathlib import PurePosixPath, PureWindowsPath

import pytest

from setvector.rekordbox import (
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    location_for_path,
    path_from_location,
)


def test_windows_location_round_trip():
    path = PureWindowsPath(r"C:\Music\Tom's & Jerry #1\Café 100%.mp3")
    location = location_for_path(path)
    assert location == (
        "file://localhost/C:/Music/Tom%27s%20%26%20Jerry%20%231/Caf%C3%A9%20100%25.mp3"
    )
    assert path_from_location(location).as_posix() == "C:/Music/Tom's & Jerry #1/Café 100%.mp3"


def test_posix_location_round_trip():
    location = location_for_path(PurePosixPath("/Users/me/Música/a b.mp3"))
    assert location == "file://localhost/Users/me/M%C3%BAsica/a%20b.mp3"
    assert path_from_location(location).as_posix() == "/Users/me/Música/a b.mp3"


@pytest.mark.parametrize(
    "location",
    [
        "file://localhost/soundcloud:tracks:1044057805",
        "https://example.com/a.mp3",
        "spotify:track:1",
    ],
)
def test_non_file_locations_have_no_path(location):
    assert path_from_location(location) is None


def test_relative_path_is_rejected():
    with pytest.raises(ValueError, match="absolute"):
        location_for_path(PurePosixPath("music/a.mp3"))


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"start_seconds": -1.0}, "Inizio"),
        ({"bpm": 0.0}, "Bpm"),
        ({"meter": "four"}, "Metro"),
        ({"beat_in_bar": 5}, "Battito"),
    ],
)
def test_tempo_marker_validation(changes, message):
    values = {"start_seconds": 0.0, "bpm": 120.0, "meter": "4/4", "beat_in_bar": 1, **changes}
    with pytest.raises(ValueError, match=message):
        TempoMarker(**values)


def test_beats_per_bar_comes_from_the_meter():
    assert TempoMarker(0.0, 120.0, "3/4", 3).beats_per_bar == 3


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"kind": "jump"}, "kind"),
        ({"kind": "loop"}, "loop needs End"),
        ({"end_seconds": 1.0}, "after Start"),
        ({"slot": 8}, "Num"),
        ({"colour": (256, 0, 0)}, "colour"),
        ({"colour": (1, 2)}, "colour"),
    ],
)
def test_position_mark_validation(changes, message):
    values = {"name": "", "kind": "cue", "start_seconds": 2.0, **changes}
    with pytest.raises(ValueError, match=message):
        PositionMark(**values)


def test_setvector_marks_are_recognised_by_prefix():
    assert PositionMark("SV Drop", "cue", 1.0).is_setvector
    assert not PositionMark("Drop", "cue", 1.0).is_setvector


def test_track_rejects_repeated_identity_attributes():
    with pytest.raises(ValueError, match="TrackID or Location"):
        RekordboxTrack(1, "file://localhost/C:/a.mp3", (("Location", "x"),))


def test_track_attribute_lookup_and_path():
    track = RekordboxTrack(7, "file://localhost/C:/a%20b.mp3", (("Name", "A"),))
    assert track.attribute("Name") == "A"
    assert track.attribute("Genre") is None
    assert track.path.as_posix() == "C:/a b.mp3"


def test_library_rejects_duplicate_track_ids():
    track = RekordboxTrack(1, "file://localhost/C:/a.mp3")
    with pytest.raises(ValueError, match="duplicate TrackID 1"):
        RekordboxLibrary("rekordbox", "7.2.19", (track, track))


def test_track_rejects_a_non_tempo_marker_item():
    with pytest.raises(ValueError, match="tempo must contain TempoMarker values"):
        RekordboxTrack(1, "file://localhost/C:/a.mp3", tempo=(1,))


def test_track_rejects_a_non_position_mark_item():
    with pytest.raises(ValueError, match="marks must contain PositionMark values"):
        RekordboxTrack(1, "file://localhost/C:/a.mp3", marks=(1,))


def test_track_rejects_a_non_string_extra_element():
    with pytest.raises(ValueError, match="extra_elements must contain XML text"):
        RekordboxTrack(1, "file://localhost/C:/a.mp3", extra_elements=(1,))


def test_track_rejects_a_non_string_attribute_value():
    with pytest.raises(ValueError, match="attributes must be pairs of text"):
        RekordboxTrack(1, "file://localhost/C:/a.mp3", attributes=(("Name", 1),))


def test_library_rejects_a_non_string_product_version():
    with pytest.raises(ValueError, match="product_version"):
        RekordboxLibrary("rekordbox", 7.2, ())


def test_library_rejects_a_string_passed_as_tracks():
    with pytest.raises(ValueError, match="tracks must contain RekordboxTrack values"):
        RekordboxLibrary("rekordbox", "7.2.19", "not-a-tuple")
