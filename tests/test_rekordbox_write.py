"""Rendered Rekordbox XML is deterministic and reads back unchanged."""

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from setvector.domain import ArtifactError
from setvector.rekordbox import (
    PositionMark,
    RekordboxTrack,
    TempoMarker,
    format_decimal,
    parse_library,
    read_library,
    render_library,
)

FIXTURE = Path(__file__).resolve().parent / "data" / "rekordbox-collection.xml"


def test_format_decimal_uses_rekordbox_places_unless_more_are_needed():
    assert format_decimal(124.0, 2) == "124.00"
    assert format_decimal(0.054, 3) == "0.054"
    assert format_decimal(0.1 + 0.2, 3) == "0.30000000000000004"
    assert format_decimal(-0.0, 3) == "0.000"


def test_rendering_reads_back_identically_and_is_deterministic():
    tracks = read_library(FIXTURE).tracks
    data = render_library(tracks, "SetVector")
    assert render_library(tracks, "SetVector") == data
    library = parse_library(data)
    assert library.tracks == tracks
    assert library.product_name == "SetVector"


def test_output_has_a_declaration_and_one_playlist_of_the_tracks():
    data = render_library(read_library(FIXTURE).tracks, "My & Set")
    assert data.startswith(b'<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS')
    root = ET.fromstring(data)
    assert root.find("COLLECTION").get("Entries") == "4"
    playlist = root.find("PLAYLISTS/NODE/NODE")
    assert (playlist.get("Name"), playlist.get("Entries")) == ("My & Set", "4")
    assert [e.get("Key") for e in playlist.findall("TRACK")] == ["101", "102", "103", "104"]


def test_unknown_elements_are_written_back():
    track = RekordboxTrack(
        1,
        "file://localhost/C:/a.mp3",
        tempo=(TempoMarker(0.0, 120.0, "4/4", 1),),
        extra_elements=('<EXTRA a="1"><X /></EXTRA>',),
    )
    assert parse_library(render_library((track,), "SetVector")).tracks == (track,)


def test_a_value_that_cannot_round_trip_is_an_artifact_error():
    track = RekordboxTrack(
        1, "file://localhost/C:/a.mp3", marks=(PositionMark("SV x", "cue", 1e-20),)
    )
    with pytest.raises(ArtifactError, match="read back"):
        render_library((track,), "SetVector")


def test_a_name_with_a_character_illegal_in_xml_is_an_artifact_error():
    track = RekordboxTrack(
        1, "file://localhost/C:/a.mp3", marks=(PositionMark("SV bad\x01name", "cue", 1.0),)
    )
    with pytest.raises(ArtifactError, match="read back"):
        render_library((track,), "SetVector")


def test_a_playlist_name_with_a_character_illegal_in_xml_is_an_artifact_error():
    track = RekordboxTrack(1, "file://localhost/C:/a.mp3")
    with pytest.raises(ArtifactError, match="read back"):
        render_library((track,), "bad\x0bname")


def test_round_trip_preserves_special_characters_in_attributes():
    value = 'Café "Night\'s" <Edit> & Co'
    track = RekordboxTrack(
        1,
        "file://localhost/C:/a.mp3",
        attributes=(("Name", value), ("Artist", value), ("Comments", value)),
    )
    assert parse_library(render_library((track,), "SetVector")).tracks == (track,)
