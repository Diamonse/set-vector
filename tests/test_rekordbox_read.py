"""Reading Rekordbox collection exports strictly, keeping everything a rewrite needs."""

from pathlib import Path

import pytest

from setvector.domain import InputError
from setvector.rekordbox import TempoMarker, parse_library, read_library

FIXTURE = Path(__file__).resolve().parent / "data" / "rekordbox-collection.xml"
TRACK = '<TRACK TrackID="1" Location="file://localhost/C:/a.mp3">{}</TRACK>'


def document(tracks, product='<PRODUCT Name="rekordbox" Version="7.2.19"/>'):
    return (
        '<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0">'
        f"{product}<COLLECTION>{tracks}</COLLECTION></DJ_PLAYLISTS>"
    ).encode()


def test_reads_product_and_every_track():
    library = read_library(FIXTURE)
    assert (library.product_name, library.product_version) == ("rekordbox", "7.2.18")
    assert [track.track_id for track in library.tracks] == [101, 102, 103, 104]


def test_track_attributes_are_kept_verbatim_in_order():
    track = read_library(FIXTURE).tracks[0]
    assert track.attributes[:3] == (
        ("Name", "Club Track"),
        ("Artist", "Artist A"),
        ("Composer", ""),
    )
    assert track.attribute("Tonality") == "8A"
    assert "TrackID" not in dict(track.attributes)
    assert "Location" not in dict(track.attributes)


def test_locations_decode_to_local_paths():
    tracks = read_library(FIXTURE).tracks
    assert tracks[0].path.as_posix() == "C:/Music/Tom's & Jerry #1/Café 100%.mp3"
    assert tracks[2].path is None


def test_tempo_markers_and_position_marks():
    track = read_library(FIXTURE).tracks[1]
    assert track.tempo == (
        TempoMarker(0.051, 123.0, "4/4", 3),
        TempoMarker(120.051, 126.0, "4/4", 1),
    )
    hot, memory, loop, own = track.marks
    assert (hot.slot, hot.colour, hot.start_seconds) == (1, (69, 172, 219), 97.609)
    assert (memory.slot, memory.colour) == (None, None)
    assert (loop.kind, loop.end_seconds) == ("loop", 37.742)
    assert own.is_setvector and own.slot == 7


def test_unknown_track_children_are_kept_without_whitespace():
    xml = TRACK.format('\n  <EXTRA a="1">\n    <X/>\n  </EXTRA>\n')
    assert parse_library(document(xml)).tracks[0].extra_elements == ('<EXTRA a="1"><X /></EXTRA>',)


def test_a_library_without_product_is_accepted():
    library = parse_library(document("", product=""))
    assert library.product_version is None
    assert library.tracks == ()


def test_unreadable_file_is_an_input_error(tmp_path):
    with pytest.raises(InputError, match="cannot read"):
        read_library(tmp_path / "missing.xml")


TEMPO = '<TEMPO Inizio="0" Bpm="{bpm}" Metro="4/4" Battito="{beat}"{extra}/>'


@pytest.mark.parametrize(
    "data, message",
    [
        (b"<DJ_PLAYLISTS>", "not valid XML"),
        (b'<!DOCTYPE x [<!ENTITY a "b">]><DJ_PLAYLISTS/>', "DOCTYPE"),
        (
            '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY a "b">]>'
            "<DJ_PLAYLISTS/>".encode("utf-16"),
            "DOCTYPE",
        ),
        (b"<PLAYLIST/>", "not a Rekordbox XML export"),
        (b"<DJ_PLAYLISTS/>", "no COLLECTION"),
        (document('<TRACK TrackID="1"/>'), "track 1: missing attribute Location"),
        (
            document('<TRACK TrackID="x" Location="file://localhost/C:/a.mp3"/>'),
            "TrackID must be an integer",
        ),
        (
            document(TRACK.format(TEMPO.format(bpm="fast", beat=1, extra=""))),
            "Bpm must be a number",
        ),
        (
            document(TRACK.format('<TEMPO Bpm="120" Metro="4/4" Battito="1"/>')),
            "missing attribute Inizio",
        ),
        (document(TRACK.format(TEMPO.format(bpm=120, beat=5, extra=""))), "Battito"),
        (
            document(TRACK.format(TEMPO.format(bpm=120, beat=1, extra=' Swing="1"'))),
            "unsupported attributes: Swing",
        ),
        (
            document(TRACK.format('<POSITION_MARK Type="0" Start="1" Num="0" Red="1"/>')),
            "all of Red, Green, Blue",
        ),
        (document(TRACK.format('<POSITION_MARK Type="0" Start="1" Num="8"/>')), "Num"),
        (document(TRACK.format('<POSITION_MARK Type="9" Start="1" Num="-1"/>')), "Type 9"),
        (document(TRACK.format("") + TRACK.format("")), "duplicate TrackID 1"),
    ],
)
def test_invalid_documents_are_input_errors(data, message):
    with pytest.raises(InputError, match=message):
        parse_library(data)
