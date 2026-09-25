# Rekordbox Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Rekordbox XML exports as reference data and write importable Rekordbox XML that adds SetVector grids and cues without replacing existing grids or user cues, plus a probe that qualifies the user's Rekordbox version.

**Architecture:** A new optional package `setvector.rekordbox` holds pure, immutable records and functions (read, grid conversion, cue placement, rendering, comparison). `setvector.application.rekordbox` coordinates library reading, cached analysis and atomic writing; the CLI gains `rekordbox inspect` and `rekordbox export`. `scripts/rekordbox_probe.py` runs a manual import experiment with synthetic drum tracks.

**Tech Stack:** Python 3.11 standard library (`xml.etree.ElementTree`, `urllib.parse`), NumPy and soundfile for the probe's audio, pytest, Ruff.

**Spec:** `docs/superpowers/specs/2026-09-25-rekordbox-bridge-design.md`

## Global Constraints

- Work in the worktree `.worktrees/rekordbox-bridge` on branch `feat/rekordbox-bridge`. In every command, `python` means `.\.venv\Scripts\python.exe` inside that worktree.
- Core analysis must not import `setvector.rekordbox`. The package depends only on `setvector.domain`, the package version, and the standard library. It adds no dependencies and never uses the network.
- Existing Rekordbox grids are copied unchanged; SetVector writes a grid only for a track without one. User cues are never changed; SetVector cues carry the `SV ` name prefix.
- Commits use Conventional Commits with no trailers of any kind (`AGENTS.md`).
- Personal Rekordbox exports and audio never go into Git; test fixtures are synthetic.
- Before each commit, run `python -m ruff format` and `python -m ruff check` on the changed files and fix what they report (wrap lines over 100 characters). Ruff also formats Python code blocks in Markdown files.

## File map

| File | Responsibility |
|---|---|
| `src/setvector/rekordbox/__init__.py` | Public exports of the package. |
| `src/setvector/rekordbox/model.py` | `TempoMarker`, `PositionMark`, `RekordboxTrack`, `RekordboxLibrary`, location helpers, colour validation. |
| `src/setvector/rekordbox/read.py` | `read_library`, `parse_library`. |
| `src/setvector/rekordbox/grid.py` | `expand_tempo`, `tempo_markers_for`. |
| `src/setvector/rekordbox/profile.py` | `CapabilityProfile`, `UNVERIFIED`, `PROFILES`, `profile_for`. |
| `src/setvector/rekordbox/cues.py` | `CueRequest`, `CueOutcome`, `CuePlacement`, `place_cues`. |
| `src/setvector/rekordbox/write.py` | `format_decimal`, `render_library`. |
| `src/setvector/rekordbox/compare.py` | `compare_libraries`, `compare_track`. |
| `src/setvector/storage/reports.py` | Gains `write_file`; `write_report` delegates to it. |
| `src/setvector/application/rekordbox.py` | `inspect_library`, `load_cue_requests`, `build_rekordbox_import`, `RekordboxExportOutcome`. |
| `src/setvector/cli/__init__.py` | `rekordbox inspect`, `rekordbox export`. |
| `scripts/rekordbox_probe.py` | `generate`, `stage2`, `check`. |
| `tests/data/rekordbox-collection.xml` | Synthetic export in Rekordbox 7.2.18's format. |
| `tests/test_rekordbox_*.py`, `tests/test_application_rekordbox.py` | Unit tests per module. |
| `docs/architecture.md`, `docs/development.md`, `README.md`, `docs/rekordbox-compatibility.md` | Documentation. |

---

### Task 0: Prepare the worktree environment

**Files:** none.

- [ ] **Step 1: Create the virtual environment and install the project**

Run in PowerShell from the worktree root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe scripts/fetch_model.py
.\.venv\Scripts\python.exe -m pip install --no-build-isolation -e .
```

Expected: the fetch script reports the verified `beat_this-final0.npz`; the editable install succeeds.

- [ ] **Step 2: Confirm a clean baseline**

Run: `python -m pytest -q` then `python -m ruff check .` and `python -m ruff format --check .`
Expected: all tests pass (365 at the start); Ruff reports no problems.

---

### Task 1: Rekordbox records and locations

**Files:**
- Create: `src/setvector/rekordbox/__init__.py`, `src/setvector/rekordbox/model.py`
- Test: `tests/test_rekordbox_model.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_model.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_model.py -v`
Expected: collection error, `ModuleNotFoundError: No module named 'setvector.rekordbox'`.

- [ ] **Step 3: Implement the records**

`src/setvector/rekordbox/model.py`:

```python
"""Immutable records read from and written to Rekordbox XML."""

import re
from dataclasses import dataclass
from pathlib import Path, PurePath
from urllib.parse import quote, unquote

from setvector.domain._validation import finite_number

HOT_CUE_SLOTS = 8
SETVECTOR_PREFIX = "SV "
MARK_KINDS = ("cue", "fade_in", "fade_out", "load", "loop")
_LOCAL_PREFIX = "file://localhost/"
_DRIVE = re.compile(r"^[A-Za-z]:/")
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_METER = re.compile(r"^([1-9][0-9]*)/([1-9][0-9]*)$")


def _nonnegative(value: object, field: str) -> float:
    number = finite_number(value, field)
    if number < 0:
        raise ValueError(f"{field} must be nonnegative")
    return number


def validate_colour(value: object) -> tuple[int, int, int] | None:
    """Return an RGB triple of integers from 0 to 255, or ``None``."""
    if value is None:
        return None
    colour = tuple(value) if isinstance(value, (tuple, list)) else ()
    if len(colour) != 3 or any(type(c) is not int or not 0 <= c <= 255 for c in colour):
        raise ValueError("colour must be three integers from 0 to 255")
    return colour


def path_from_location(location: str) -> Path | None:
    """Decode a ``file://localhost/`` URI; streaming and other locations give ``None``."""
    if not location.startswith(_LOCAL_PREFIX):
        return None
    rest = unquote(location[len(_LOCAL_PREFIX) :])
    if _DRIVE.match(rest):
        return Path(rest)
    if _SCHEME.match(rest):
        return None
    return Path("/" + rest)


def location_for_path(path: PurePath) -> str:
    """Encode an absolute local path the way Rekordbox writes ``Location``."""
    posix = path.as_posix()
    if _DRIVE.match(posix):
        return _LOCAL_PREFIX + posix[:3] + quote(posix[3:], safe="/")
    if not posix.startswith("/"):
        raise ValueError(f"path must be absolute: {posix}")
    return _LOCAL_PREFIX + quote(posix[1:], safe="/")


@dataclass(frozen=True, slots=True)
class TempoMarker:
    """A Rekordbox ``TEMPO`` anchor: a beat at ``start_seconds`` and the grid after it."""

    start_seconds: float
    bpm: float
    meter: str
    beat_in_bar: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "start_seconds", _nonnegative(self.start_seconds, "Inizio"))
        bpm = finite_number(self.bpm, "Bpm")
        if bpm <= 0:
            raise ValueError("Bpm must be positive")
        object.__setattr__(self, "bpm", bpm)
        if not isinstance(self.meter, str) or _METER.fullmatch(self.meter) is None:
            raise ValueError("Metro must look like 4/4")
        if type(self.beat_in_bar) is not int or not 1 <= self.beat_in_bar <= self.beats_per_bar:
            raise ValueError("Battito must be a beat number within the bar")

    @property
    def beats_per_bar(self) -> int:
        """The meter's numerator."""
        return int(self.meter.split("/")[0])


@dataclass(frozen=True, slots=True)
class PositionMark:
    """A Rekordbox ``POSITION_MARK``: a memory cue (``slot`` None) or hot cue A–H (0–7)."""

    name: str
    kind: str
    start_seconds: float
    end_seconds: float | None = None
    slot: int | None = None
    colour: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.name, str):
            raise ValueError("Name must be text")
        if self.kind not in MARK_KINDS:
            raise ValueError(f"kind must be one of {', '.join(MARK_KINDS)}")
        start = _nonnegative(self.start_seconds, "Start")
        object.__setattr__(self, "start_seconds", start)
        if self.end_seconds is not None:
            end = finite_number(self.end_seconds, "End")
            if end <= start:
                raise ValueError("End must be after Start")
            object.__setattr__(self, "end_seconds", end)
        if self.kind == "loop" and self.end_seconds is None:
            raise ValueError("a loop needs End")
        if self.slot is not None and (
            type(self.slot) is not int or not 0 <= self.slot < HOT_CUE_SLOTS
        ):
            raise ValueError("Num must be -1 or a hot cue slot from 0 to 7")
        object.__setattr__(self, "colour", validate_colour(self.colour))

    @property
    def is_setvector(self) -> bool:
        """Whether SetVector wrote this mark, judged by its name prefix."""
        return self.name.startswith(SETVECTOR_PREFIX)


@dataclass(frozen=True, slots=True)
class RekordboxTrack:
    """One ``COLLECTION/TRACK`` record; ``attributes`` keeps every other attribute verbatim."""

    track_id: int
    location: str
    attributes: tuple[tuple[str, str], ...] = ()
    tempo: tuple[TempoMarker, ...] = ()
    marks: tuple[PositionMark, ...] = ()
    extra_elements: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if type(self.track_id) is not int or self.track_id <= 0:
            raise ValueError("TrackID must be a positive integer")
        if not isinstance(self.location, str) or not self.location:
            raise ValueError("Location must be a nonempty URI")
        attributes = tuple((str(name), str(value)) for name, value in self.attributes)
        if any(name in ("TrackID", "Location") for name, _ in attributes):
            raise ValueError("attributes must not repeat TrackID or Location")
        object.__setattr__(self, "attributes", attributes)
        object.__setattr__(self, "tempo", tuple(self.tempo))
        object.__setattr__(self, "marks", tuple(self.marks))
        object.__setattr__(self, "extra_elements", tuple(self.extra_elements))

    @property
    def path(self) -> Path | None:
        """The local audio file, or ``None`` for streaming and other non-file locations."""
        return path_from_location(self.location)

    def attribute(self, name: str, default: str | None = None) -> str | None:
        """Return one of the verbatim ``TRACK`` attributes."""
        return dict(self.attributes).get(name, default)


@dataclass(frozen=True, slots=True)
class RekordboxLibrary:
    """The product that wrote an XML document and its collection tracks."""

    product_name: str | None
    product_version: str | None
    tracks: tuple[RekordboxTrack, ...]

    def __post_init__(self) -> None:
        tracks = tuple(self.tracks)
        seen: set[int] = set()
        for track in tracks:
            if track.track_id in seen:
                raise ValueError(f"duplicate TrackID {track.track_id}")
            seen.add(track.track_id)
        object.__setattr__(self, "tracks", tracks)
```

`src/setvector/rekordbox/__init__.py`:

```python
"""Rekordbox XML exchange: read collection exports and write importable projections."""

from .model import (
    HOT_CUE_SLOTS,
    SETVECTOR_PREFIX,
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    location_for_path,
    path_from_location,
    validate_colour,
)

__all__ = [
    "HOT_CUE_SLOTS",
    "SETVECTOR_PREFIX",
    "PositionMark",
    "RekordboxLibrary",
    "RekordboxTrack",
    "TempoMarker",
    "location_for_path",
    "path_from_location",
    "validate_colour",
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_model.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/rekordbox tests/test_rekordbox_model.py
git commit -m "feat(rekordbox): add Rekordbox track, grid and cue records"
```

---

### Task 2: Read Rekordbox XML

**Files:**
- Create: `src/setvector/rekordbox/read.py`, `tests/data/rekordbox-collection.xml`
- Modify: `src/setvector/rekordbox/__init__.py`
- Test: `tests/test_rekordbox_read.py`

- [ ] **Step 1: Add the synthetic export fixture**

`tests/data/rekordbox-collection.xml` (modelled on Rekordbox 7.2.18's layout, including its multi-line attributes):

```xml
<?xml version="1.0" encoding="UTF-8"?>

<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.2.18" Company="AlphaTheta"/>
  <COLLECTION Entries="4">
    <TRACK TrackID="101" Name="Club Track" Artist="Artist A" Composer="" Album=""
           Grouping="" Genre="Tech House" Kind="MP3 File" Size="9437184" TotalTime="360"
           DiscNumber="0" TrackNumber="0" Year="2024" AverageBpm="124.00"
           DateAdded="2026-09-01" BitRate="320" SampleRate="44100" Comments=""
           PlayCount="0" Rating="0"
           Location="file://localhost/C:/Music/Tom%27s%20%26%20Jerry%20%231/Caf%C3%A9%20100%25.mp3"
           Remixer="" Tonality="8A" Label="" Mix="">
      <TEMPO Inizio="0.054" Bpm="124.00" Metro="4/4" Battito="1"/>
    </TRACK>
    <TRACK TrackID="102" Name="Two Tempos" Artist="Artist B" Kind="MP3 File"
           AverageBpm="123.00" Location="file://localhost/C:/Music/two%20tempos.mp3">
      <TEMPO Inizio="0.051" Bpm="123.00" Metro="4/4" Battito="3"/>
      <TEMPO Inizio="120.051" Bpm="126.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="" Type="0" Start="97.609" Num="1" Red="69" Green="172"
                     Blue="219"/>
      <POSITION_MARK Name="" Type="0" Start="50.465" Num="-1"/>
      <POSITION_MARK Name="Loop" Type="4" Start="30.000" End="37.742" Num="-1"/>
      <POSITION_MARK Name="SV Drop" Type="0" Start="60.000" Num="7" Red="255" Green="0"
                     Blue="0"/>
    </TRACK>
    <TRACK TrackID="103" Name="Stream" Kind="Unknown Format" Size="0" TotalTime="222"
           Location="file://localhost/soundcloud:tracks:1044057805"/>
    <TRACK TrackID="104" Name="NOISE" Kind="WAV File"
           Location="file://localhost/C:/Music/rekordbox/Sampler/PRESET%20ONESHOT/NOISE.wav"/>
  </COLLECTION>
  <PLAYLISTS>
    <NODE Type="0" Name="ROOT" Count="1">
      <NODE Name="House Practice" Type="1" KeyType="0" Entries="1">
        <TRACK Key="101"/>
      </NODE>
    </NODE>
  </PLAYLISTS>
</DJ_PLAYLISTS>
```

- [ ] **Step 2: Write the failing tests**

`tests/test_rekordbox_read.py`:

```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_read.py -v`
Expected: ImportError for `parse_library`.

- [ ] **Step 4: Implement the reader**

`src/setvector/rekordbox/read.py`:

```python
"""Read a Rekordbox collection export into immutable records."""

import xml.etree.ElementTree as ET
from collections.abc import Mapping
from pathlib import Path

from setvector.domain import InputError

from .model import PositionMark, RekordboxLibrary, RekordboxTrack, TempoMarker

_TYPE_TO_KIND = {"0": "cue", "1": "fade_in", "2": "fade_out", "3": "load", "4": "loop"}
_TEMPO_FIELDS = {"Inizio", "Bpm", "Metro", "Battito"}
_MARK_FIELDS = {"Name", "Type", "Start", "End", "Num", "Red", "Green", "Blue"}
_COLOUR = ("Red", "Green", "Blue")


def read_library(path: str | Path) -> RekordboxLibrary:
    """Read a Rekordbox XML file; unreadable or invalid documents raise ``InputError``."""
    source = Path(path)
    try:
        data = source.read_bytes()
    except OSError as error:
        raise InputError(f"cannot read Rekordbox XML {source}: {error}") from error
    return parse_library(data, str(source))


def parse_library(data: bytes, source: str = "Rekordbox XML") -> RekordboxLibrary:
    """Parse Rekordbox XML bytes. Playlists are not read.

    Documents declaring a DOCTYPE or entities are refused; Rekordbox never writes them.
    """
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise InputError(f"{source} must not contain a DOCTYPE or entity declarations")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as error:
        raise InputError(f"{source} is not valid XML: {error}") from error
    if root.tag != "DJ_PLAYLISTS":
        raise InputError(f"{source} is not a Rekordbox XML export (root is {root.tag})")
    collection = root.find("COLLECTION")
    if collection is None:
        raise InputError(f"{source} has no COLLECTION")
    tracks = []
    for index, element in enumerate(collection.findall("TRACK"), 1):
        label = element.get("TrackID") or f"#{index}"
        try:
            tracks.append(_track(element))
        except KeyError as error:
            raise InputError(
                f"{source}: track {label}: missing attribute {error.args[0]}"
            ) from error
        except ValueError as error:
            raise InputError(f"{source}: track {label}: {error}") from error
    product = root.find("PRODUCT")
    try:
        return RekordboxLibrary(
            product.get("Name") if product is not None else None,
            product.get("Version") if product is not None else None,
            tuple(tracks),
        )
    except ValueError as error:
        raise InputError(f"{source}: {error}") from error


def _track(element: ET.Element) -> RekordboxTrack:
    attributes = dict(element.attrib)
    track_id = _integer(attributes.pop("TrackID"), "TrackID")
    location = attributes.pop("Location")
    tempo, marks, extra = [], [], []
    for child in element:
        if child.tag == "TEMPO":
            tempo.append(_tempo(child.attrib))
        elif child.tag == "POSITION_MARK":
            marks.append(_mark(child.attrib))
        else:
            extra.append(_serialize(child))
    return RekordboxTrack(
        track_id, location, tuple(attributes.items()), tuple(tempo), tuple(marks), tuple(extra)
    )


def _tempo(attributes: Mapping[str, str]) -> TempoMarker:
    _check_fields(attributes, _TEMPO_FIELDS, "TEMPO")
    return TempoMarker(
        _number(attributes["Inizio"], "Inizio"),
        _number(attributes["Bpm"], "Bpm"),
        attributes["Metro"],
        _integer(attributes["Battito"], "Battito"),
    )


def _mark(attributes: Mapping[str, str]) -> PositionMark:
    _check_fields(attributes, _MARK_FIELDS, "POSITION_MARK")
    kind = _TYPE_TO_KIND.get(attributes["Type"])
    if kind is None:
        raise ValueError(f"unsupported POSITION_MARK Type {attributes['Type']}")
    number = _integer(attributes.get("Num", "-1"), "Num")
    present = [name in attributes for name in _COLOUR]
    if any(present) and not all(present):
        raise ValueError("POSITION_MARK needs all of Red, Green, Blue or none")
    colour = tuple(_integer(attributes[name], name) for name in _COLOUR) if all(present) else None
    end = _number(attributes["End"], "End") if "End" in attributes else None
    return PositionMark(
        attributes.get("Name", ""),
        kind,
        _number(attributes["Start"], "Start"),
        end,
        None if number == -1 else number,
        colour,
    )


def _check_fields(attributes: Mapping[str, str], allowed: set[str], tag: str) -> None:
    unknown = set(attributes) - allowed
    if unknown:
        raise ValueError(f"{tag} has unsupported attributes: {', '.join(sorted(unknown))}")


def _integer(text: str, field: str) -> int:
    try:
        return int(text)
    except ValueError as error:
        raise ValueError(f"{field} must be an integer") from error


def _number(text: str, field: str) -> float:
    try:
        return float(text)
    except ValueError as error:
        raise ValueError(f"{field} must be a number") from error


def _serialize(element: ET.Element) -> str:
    """Serialize an unknown element without insignificant whitespace, for a stable rewrite."""
    copy = ET.fromstring(ET.tostring(element))
    for node in copy.iter():
        if node.text is not None and not node.text.strip():
            node.text = None
        if node.tail is not None and not node.tail.strip():
            node.tail = None
    copy.tail = None
    return ET.tostring(copy, encoding="unicode")
```

Add to `src/setvector/rekordbox/__init__.py` the import `from .read import parse_library, read_library` and the names `"parse_library"` and `"read_library"` in `__all__` (keep `__all__` sorted).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_read.py tests/test_rekordbox_model.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/setvector/rekordbox tests/data/rekordbox-collection.xml tests/test_rekordbox_read.py
git commit -m "feat(rekordbox): read Rekordbox collection exports"
```

---

### Task 3: Expand Rekordbox grids into beats

**Files:**
- Create: `src/setvector/rekordbox/grid.py`
- Modify: `src/setvector/rekordbox/__init__.py`
- Test: `tests/test_rekordbox_grid.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_grid.py`:

```python
"""Rekordbox tempo markers expand to beats, and SetVector grids convert to markers."""

import pytest

from setvector.rekordbox import TempoMarker, expand_tempo


def test_single_marker_fills_to_the_end_with_bar_positions():
    beats, positions = expand_tempo((TempoMarker(0.5, 120.0, "4/4", 3),), 3.0)
    assert beats == pytest.approx((0.5, 1.0, 1.5, 2.0, 2.5))
    assert positions == (3, 4, 1, 2, 3)


def test_a_later_marker_resets_timing_and_bar_phase():
    markers = (TempoMarker(0.0, 120.0, "4/4", 1), TempoMarker(2.0, 120.0, "4/4", 3))
    beats, positions = expand_tempo(markers, 3.0)
    assert beats == pytest.approx((0.0, 0.5, 1.0, 1.5, 2.0, 2.5))
    assert positions == (1, 2, 3, 4, 3, 4)


def test_a_rounded_anchor_does_not_create_a_duplicate_beat():
    markers = (TempoMarker(0.0, 120.0, "4/4", 1), TempoMarker(2.003, 120.0, "4/4", 1))
    beats, _ = expand_tempo(markers, 2.6)
    assert beats == pytest.approx((0.0, 0.5, 1.0, 1.5, 2.003, 2.503))


def test_markers_are_sorted_and_markers_past_the_end_are_ignored():
    markers = (TempoMarker(10.0, 120.0, "4/4", 1), TempoMarker(0.0, 120.0, "4/4", 1))
    beats, _ = expand_tempo(markers, 1.2)
    assert beats == pytest.approx((0.0, 0.5, 1.0))


def test_three_four_meter_cycles_three_positions():
    _, positions = expand_tempo((TempoMarker(0.0, 90.0, "3/4", 2),), 4.0)
    assert positions == (2, 3, 1, 2, 3, 1)


def test_no_markers_give_no_beats():
    assert expand_tempo((), 10.0) == ((), ())


def test_an_absurd_marker_is_rejected():
    with pytest.raises(ValueError, match="more than"):
        expand_tempo((TempoMarker(0.0, 1e7, "4/4", 1),), 10.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_grid.py -v`
Expected: ImportError for `expand_tempo`.

- [ ] **Step 3: Implement `expand_tempo`**

`src/setvector/rekordbox/grid.py`:

```python
"""Convert between Rekordbox tempo markers and beat grids."""

import math
from collections.abc import Sequence

from .model import TempoMarker

MAX_BEATS_PER_MARKER = 200_000


def expand_tempo(
    markers: Sequence[TempoMarker], duration_seconds: float
) -> tuple[tuple[float, ...], tuple[int, ...]]:
    """Return beat times and bar positions for Rekordbox markers over the decoded duration.

    Each marker is a beat anchor. Beats advance by ``60 / bpm`` to the next marker or the
    end, and ``beat_in_bar`` advances modulo the meter; a later marker resets both. A beat
    predicted within a quarter of the local interval (at most 120 ms) before the next
    marker is dropped, because Rekordbox rounds anchors to milliseconds. Nothing is
    extrapolated before the first marker.
    """
    ordered = [marker for _, marker in sorted(enumerate(markers), key=_marker_order)]
    beats: list[float] = []
    positions: list[int] = []
    for index, marker in enumerate(ordered):
        interval = 60.0 / marker.bpm
        end = duration_seconds
        if index + 1 < len(ordered):
            following = ordered[index + 1]
            guard = min(0.120, interval * 0.25, 60.0 / following.bpm * 0.25)
            end = min(duration_seconds, following.start_seconds - guard)
        if marker.start_seconds >= end:
            continue
        count = math.ceil((end - marker.start_seconds - 1e-9) / interval)
        if count > MAX_BEATS_PER_MARKER:
            raise ValueError(
                f"a tempo marker would expand to more than {MAX_BEATS_PER_MARKER} beats"
            )
        for step in range(count):
            beat = marker.start_seconds + step * interval
            if beat >= end - 1e-9:
                continue
            position = (marker.beat_in_bar - 1 + step) % marker.beats_per_bar + 1
            if beats and beat - beats[-1] < 0.001:
                beats[-1], positions[-1] = beat, position
            else:
                beats.append(beat)
                positions.append(position)
    return tuple(beats), tuple(positions)


def _marker_order(item: tuple[int, TempoMarker]) -> tuple[float, int]:
    index, marker = item
    return marker.start_seconds, index
```

Add `from .grid import expand_tempo` to `src/setvector/rekordbox/__init__.py` and `"expand_tempo"` to `__all__`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_grid.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/rekordbox tests/test_rekordbox_grid.py
git commit -m "feat(rekordbox): expand Rekordbox tempo markers into beats and bars"
```

---

### Task 4: Convert SetVector grids into tempo markers

**Files:**
- Modify: `src/setvector/rekordbox/grid.py`, `src/setvector/rekordbox/__init__.py`
- Test: `tests/test_rekordbox_grid.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_rekordbox_grid.py`, and extend its imports to:

```python
from dataclasses import replace

import pytest

from setvector.domain import CandidateQuality, GridSegment
from setvector.rekordbox import TempoMarker, expand_tempo, tempo_markers_for
```

```python
def assert_expands_to(markers, rhythm):
    beats, positions = expand_tempo(markers, rhythm.beats[-1] + 0.1)
    assert len(beats) == len(rhythm.beats)
    assert max(abs(a - b) for a, b in zip(beats, rhythm.beats, strict=True)) <= 0.005
    assert positions == rhythm.bar_positions


def test_each_grid_segment_becomes_a_marker(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(
        bundle, segments=(GridSegment(0.5, 120.0, 8, 1), GridSegment(4.5, 128.0, 8, 1))
    )
    markers = tempo_markers_for(rhythm)
    assert markers == (TempoMarker(0.5, 120.0, "4/4", 1), TempoMarker(4.5, 128.0, "4/4", 1))
    assert_expands_to(markers, rhythm)


def test_markers_are_added_where_bpm_rounding_would_drift(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.2504, 124.004, 800, 1),))
    markers = tempo_markers_for(rhythm)
    assert len(markers) > 1
    assert all(marker.bpm == 124.0 for marker in markers)
    assert markers[0].start_seconds == 0.25
    assert_expands_to(markers, rhythm)


def test_a_phase_change_inside_a_segment_starts_a_new_marker(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 12, 1),))
    shifted = replace(rhythm, bar_positions=(1, 2, 3, 4, 1, 2, 1, 2, 3, 4, 1, 2))
    markers = tempo_markers_for(shifted)
    assert markers == (TempoMarker(0.5, 120.0, "4/4", 1), TempoMarker(3.5, 120.0, "4/4", 1))
    assert_expands_to(markers, shifted)


def test_three_beat_bars_write_three_four(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 9, 1),))
    waltz = replace(
        rhythm,
        bar_positions=tuple(i % 3 + 1 for i in range(9)),
        quality={"beat_this": CandidateQuality(9, 0.01, 1.0, 1, 3, 1.0)},
    )
    assert tempo_markers_for(waltz) == (TempoMarker(0.5, 120.0, "3/4", 1),)


def test_bar_positions_beyond_the_meter_are_rejected(report_inputs, rhythm_factory):
    _, bundle = report_inputs()
    rhythm = rhythm_factory(bundle, segments=(GridSegment(0.5, 120.0, 8, 1),))
    long_bar = replace(rhythm, bar_positions=(1, 2, 3, 4, 5, 1, 2, 3))
    with pytest.raises(ValueError, match="meter"):
        tempo_markers_for(long_bar)


@pytest.mark.parametrize("source", ["setvector_fallback", "none"])
def test_only_reliable_beat_this_grids_convert(report_inputs, rhythm_factory, source):
    _, bundle = report_inputs()
    with pytest.raises(ValueError, match="beat_this"):
        tempo_markers_for(rhythm_factory(bundle, source=source))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_grid.py -v`
Expected: ImportError for `tempo_markers_for`.

- [ ] **Step 3: Implement `tempo_markers_for`**

Add to `src/setvector/rekordbox/grid.py` (extend the imports with `from setvector.domain import RhythmAnalysis`):

```python
DRIFT_TOLERANCE_SECONDS = 0.005


def tempo_markers_for(rhythm: RhythmAnalysis) -> tuple[TempoMarker, ...]:
    """Convert a reliable Beat This! grid into Rekordbox tempo markers.

    Rekordbox stores ``Inizio`` in milliseconds and ``Bpm`` with two decimals. A marker
    is added wherever that rounding would move a beat more than 5 ms from SetVector's
    grid, and wherever the bar phase does not continue modulo the meter.
    """
    if rhythm.source != "beat_this" or not rhythm.reliable:
        raise ValueError("only a reliable beat_this rhythm has a bar grid to convert")
    bar_length = rhythm.quality["beat_this"].modal_bar_length
    if bar_length is None or any(p is None or p > bar_length for p in rhythm.bar_positions):
        raise ValueError("bar positions do not fit the meter")
    meter = f"{bar_length}/4"
    markers: list[TempoMarker] = []
    first = 0
    for segment in rhythm.grid_segments:
        times = segment.times()
        positions = rhythm.bar_positions[first : first + segment.beat_count]
        first += segment.beat_count
        bpm = round(segment.bpm, 2)
        period = 60.0 / bpm
        anchor = 0
        while anchor < len(times):
            start = round(times[anchor], 3)
            markers.append(TempoMarker(start, bpm, meter, positions[anchor]))
            step = 1
            while anchor + step < len(times):
                expected_position = (positions[anchor] - 1 + step) % bar_length + 1
                drift = abs(start + step * period - times[anchor + step])
                if positions[anchor + step] != expected_position or drift > DRIFT_TOLERANCE_SECONDS:
                    break
                step += 1
            anchor += step
    return tuple(markers)
```

Add `tempo_markers_for` to the `from .grid import ...` line in `src/setvector/rekordbox/__init__.py` and to `__all__`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_grid.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/rekordbox tests/test_rekordbox_grid.py
git commit -m "feat(rekordbox): convert Beat This! grids into Rekordbox tempo markers"
```

---

### Task 5: Capability profiles and cue placement

**Files:**
- Create: `src/setvector/rekordbox/profile.py`, `src/setvector/rekordbox/cues.py`
- Modify: `src/setvector/rekordbox/__init__.py`
- Test: `tests/test_rekordbox_cues.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_cues.py`:

```python
"""SetVector cues fill free slots and never change the user's cues."""

from dataclasses import replace

import pytest

from setvector.rekordbox import (
    UNVERIFIED,
    CapabilityProfile,
    CueRequest,
    PositionMark,
    place_cues,
    profile_for,
)
from setvector.rekordbox import profile as profile_module

USER_HOT = PositionMark("", "cue", 10.0, slot=0, colour=(1, 2, 3))
USER_MEMORY = PositionMark("", "cue", 5.0)
OLD_OWN = PositionMark("SV Old", "cue", 20.0, slot=1)
EXISTING = (USER_HOT, USER_MEMORY, OLD_OWN)


def hot(label, slot=None, start=30.0):
    return CueRequest(label, start, True, preferred_slot=slot, colour=(255, 0, 0))


@pytest.mark.parametrize(
    "cue, status, slot",
    [
        (hot("Free", 2), "placed", 2),
        (hot("Taken by user", 0), "moved_slot", 1),
        (hot("Own slot", 1), "placed", 1),
        (hot("Any"), "placed", 1),
    ],
)
def test_hot_cue_slots(cue, status, slot):
    placement = place_cues(EXISTING, (cue,), UNVERIFIED)
    (outcome,) = placement.outcomes
    assert (outcome.status, outcome.slot) == (status, slot)
    assert placement.marks == (
        USER_HOT,
        USER_MEMORY,
        PositionMark("SV " + cue.label, "cue", 30.0, slot=slot, colour=(255, 0, 0)),
    )


def test_a_track_with_every_slot_used_by_the_user_is_reported():
    full = tuple(PositionMark("", "cue", float(i), slot=i) for i in range(8))
    placement = place_cues(full, (hot("Drop"),), UNVERIFIED)
    assert placement.marks == full
    assert (placement.outcomes[0].status, placement.outcomes[0].slot) == ("no_free_slot", None)


def test_hot_cues_without_preference_fill_slots_in_order():
    placement = place_cues(EXISTING, (hot("One"), hot("Two")), UNVERIFIED)
    assert [outcome.slot for outcome in placement.outcomes] == [1, 2]


def test_memory_cues_stop_at_the_profile_limit():
    profile = replace(UNVERIFIED, memory_cue_limit=2)
    requests = (CueRequest("Intro", 1.0, False), CueRequest("Outro", 2.0, False))
    placement = place_cues(EXISTING, requests, profile)
    assert [outcome.status for outcome in placement.outcomes] == ["placed", "over_memory_limit"]


def test_memory_cue_colour_is_dropped_when_the_profile_says_it_does_not_import():
    profile = replace(UNVERIFIED, memory_cue_colours=False)
    requests = (CueRequest("Intro", 1.0, False, colour=(0, 255, 0)), hot("Drop"))
    memory, hot_mark = place_cues((), requests, profile).marks
    assert memory.colour is None
    assert hot_mark.colour == (255, 0, 0)


def test_times_are_rounded_to_milliseconds_and_loops_keep_their_end():
    loop = CueRequest("Loop", 1.23456, False, kind="loop", end_seconds=3.45678)
    (mark,) = place_cues((), (loop,), UNVERIFIED).marks
    assert (mark.kind, mark.start_seconds, mark.end_seconds) == ("loop", 1.235, 3.457)


def test_repeating_an_export_gives_the_same_marks():
    first = place_cues(EXISTING, (hot("Drop", 2),), UNVERIFIED)
    assert place_cues(first.marks, (hot("Drop", 2),), UNVERIFIED).marks == first.marks


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"label": " "}, "label"),
        ({"hot": "yes"}, "hot"),
        ({"kind": "fade_in"}, "kind"),
        ({"kind": "loop"}, "end_seconds"),
        ({"end_seconds": 5.0}, "only loops"),
        ({"hot": False, "preferred_slot": 1}, "preferred_slot"),
        ({"preferred_slot": 8}, "preferred_slot"),
        ({"start_seconds": -1.0}, "start_seconds"),
        ({"colour": (1, 2)}, "colour"),
    ],
)
def test_cue_request_validation(changes, message):
    values = {"label": "Drop", "start_seconds": 1.0, "hot": True, **changes}
    with pytest.raises(ValueError, match=message):
        CueRequest(**values)


def test_cue_request_from_dict():
    data = {
        "label": "Drop",
        "start_seconds": 60,
        "hot": True,
        "preferred_slot": 0,
        "colour": [255, 0, 0],
    }
    assert CueRequest.from_dict(data) == CueRequest(
        "Drop", 60.0, True, preferred_slot=0, colour=(255, 0, 0)
    )
    with pytest.raises(ValueError, match="unknown fields: Colour"):
        CueRequest.from_dict(
            {"label": "Drop", "start_seconds": 60, "hot": True, "Colour": [1, 2, 3]}
        )
    with pytest.raises(ValueError, match="missing fields: hot"):
        CueRequest.from_dict({"label": "Drop", "start_seconds": 60})


def test_unknown_versions_get_the_unverified_profile(monkeypatch):
    assert profile_for("7.2.19") is UNVERIFIED
    assert not UNVERIFIED.verified
    measured = CapabilityProfile(("7.2.19",), 8, 10, True, "replace", True)
    monkeypatch.setattr(profile_module, "PROFILES", (measured,))
    assert profile_for("7.2.19") is measured
    assert measured.verified
    assert profile_for(None) is UNVERIFIED
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_cues.py -v`
Expected: ImportError for `UNVERIFIED`.

- [ ] **Step 3: Implement profiles**

`src/setvector/rekordbox/profile.py`:

```python
"""What each Rekordbox version is known to import, measured with scripts/rekordbox_probe.py."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CapabilityProfile:
    """Import behaviour measured for ``versions``; ``None`` means not measured.

    ``reimport`` describes a track imported again: ``replace``, ``merge`` or ``ignore``.
    """

    versions: tuple[str, ...]
    hot_cue_slots: int
    memory_cue_limit: int
    memory_cue_colours: bool | None
    reimport: str | None
    grids_survive_analysis: bool | None

    @property
    def verified(self) -> bool:
        """Whether the probe has qualified at least one Rekordbox version."""
        return bool(self.versions)


UNVERIFIED = CapabilityProfile((), 8, 10, None, None, None)
PROFILES: tuple[CapabilityProfile, ...] = ()


def profile_for(version: str | None) -> CapabilityProfile:
    """Return the measured profile for ``version``, or the unverified default."""
    for profile in PROFILES:
        if version in profile.versions:
            return profile
    return UNVERIFIED
```

- [ ] **Step 4: Implement cue placement**

`src/setvector/rekordbox/cues.py`:

```python
"""Place SetVector cues on a track without changing the user's cues."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from setvector.domain._validation import finite_number

from .model import HOT_CUE_SLOTS, SETVECTOR_PREFIX, PositionMark, validate_colour
from .profile import CapabilityProfile

_REQUIRED = {"label", "start_seconds", "hot"}
_OPTIONAL = {"kind", "end_seconds", "preferred_slot", "colour"}


@dataclass(frozen=True, slots=True)
class CueRequest:
    """A cue SetVector wants on a track; ``label`` is written after the ``SV `` prefix."""

    label: str
    start_seconds: float
    hot: bool
    kind: str = "cue"
    end_seconds: float | None = None
    preferred_slot: int | None = None
    colour: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.label, str) or not self.label.strip():
            raise ValueError("label must be nonempty text")
        if type(self.hot) is not bool:
            raise ValueError("hot must be true or false")
        if self.kind not in ("cue", "loop"):
            raise ValueError("kind must be cue or loop")
        start = finite_number(self.start_seconds, "start_seconds")
        if start < 0:
            raise ValueError("start_seconds must be nonnegative")
        object.__setattr__(self, "start_seconds", start)
        if self.kind == "loop":
            if self.end_seconds is None or finite_number(self.end_seconds, "end_seconds") <= start:
                raise ValueError("a loop needs end_seconds after start_seconds")
            object.__setattr__(self, "end_seconds", float(self.end_seconds))
        elif self.end_seconds is not None:
            raise ValueError("only loops have end_seconds")
        if self.preferred_slot is not None:
            if not self.hot:
                raise ValueError("preferred_slot needs a hot cue")
            if type(self.preferred_slot) is not int or not 0 <= self.preferred_slot < HOT_CUE_SLOTS:
                raise ValueError("preferred_slot must be from 0 to 7")
        object.__setattr__(self, "colour", validate_colour(self.colour))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "CueRequest":
        """Read one request from JSON; unknown fields are errors."""
        if not isinstance(data, Mapping):
            raise ValueError("a cue request must be an object")
        missing = _REQUIRED - data.keys()
        unknown = data.keys() - _REQUIRED - _OPTIONAL
        if missing:
            raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
        if unknown:
            raise ValueError(f"unknown fields: {', '.join(sorted(map(str, unknown)))}")
        return cls(**data)


@dataclass(frozen=True, slots=True)
class CueOutcome:
    """What happened to one request: ``placed``, ``moved_slot``, ``no_free_slot`` or
    ``over_memory_limit``."""

    request: CueRequest
    status: str
    slot: int | None


@dataclass(frozen=True, slots=True)
class CuePlacement:
    """A track's final marks and one outcome per request."""

    marks: tuple[PositionMark, ...]
    outcomes: tuple[CueOutcome, ...]


def place_cues(
    existing: Sequence[PositionMark],
    requests: Sequence[CueRequest],
    profile: CapabilityProfile,
) -> CuePlacement:
    """Replace every SetVector mark with ``requests``, keeping user marks unchanged.

    Hot cues take their preferred slot when free, otherwise the lowest free slot; slots
    held by SetVector marks count as free. Times are rounded to milliseconds, the
    precision Rekordbox exports.
    """
    user = [mark for mark in existing if not mark.is_setvector]
    taken = {mark.slot for mark in user if mark.slot is not None}
    memory_count = sum(mark.slot is None for mark in user)
    added: list[PositionMark] = []
    outcomes: list[CueOutcome] = []
    for request in requests:
        if request.hot:
            free = [slot for slot in range(profile.hot_cue_slots) if slot not in taken]
            if not free:
                outcomes.append(CueOutcome(request, "no_free_slot", None))
                continue
            if request.preferred_slot is None or request.preferred_slot in free:
                slot = free[0] if request.preferred_slot is None else request.preferred_slot
                status = "placed"
            else:
                slot, status = free[0], "moved_slot"
            taken.add(slot)
        else:
            if memory_count >= profile.memory_cue_limit:
                outcomes.append(CueOutcome(request, "over_memory_limit", None))
                continue
            memory_count += 1
            slot, status = None, "placed"
        keep_colour = request.hot or profile.memory_cue_colours is not False
        added.append(
            PositionMark(
                SETVECTOR_PREFIX + request.label,
                request.kind,
                round(request.start_seconds, 3),
                None if request.end_seconds is None else round(request.end_seconds, 3),
                slot,
                request.colour if keep_colour else None,
            )
        )
        outcomes.append(CueOutcome(request, status, slot))
    return CuePlacement(tuple(user + added), tuple(outcomes))
```

Add to `src/setvector/rekordbox/__init__.py`:

```python
from .cues import CueOutcome, CuePlacement, CueRequest, place_cues
from .profile import PROFILES, UNVERIFIED, CapabilityProfile, profile_for
```

and add `"CapabilityProfile"`, `"CueOutcome"`, `"CuePlacement"`, `"CueRequest"`, `"PROFILES"`, `"UNVERIFIED"`, `"place_cues"`, `"profile_for"` to `__all__`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_cues.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/setvector/rekordbox tests/test_rekordbox_cues.py
git commit -m "feat(rekordbox): place SetVector cues in free slots only"
```

---

### Task 6: Render Rekordbox XML and write files atomically

**Files:**
- Create: `src/setvector/rekordbox/write.py`
- Modify: `src/setvector/rekordbox/__init__.py`, `src/setvector/storage/reports.py`, `src/setvector/storage/__init__.py`
- Test: `tests/test_rekordbox_write.py`, `tests/test_storage_reports.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_write.py`:

```python
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
```

Append to `tests/test_storage_reports.py`, and change its storage import to `from setvector.storage import write_file, write_report`:

```python
def test_write_file_names_its_kind(tmp_path):
    target = tmp_path / "out.xml"
    assert write_file(target, b"<a/>").read_bytes() == b"<a/>"
    with pytest.raises(InputError, match="Rekordbox XML already exists"):
        write_file(target, b"<b/>", kind="Rekordbox XML")
    assert target.read_bytes() == b"<a/>"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_write.py tests/test_storage_reports.py -v`
Expected: ImportError for `format_decimal` and `write_file`.

- [ ] **Step 3: Generalize the atomic file writer**

Replace the body of `src/setvector/storage/reports.py` after its imports with:

```python
def write_file(
    path: str | Path, data: bytes, *, overwrite: bool = False, kind: str = "file"
) -> Path:
    """Write ``data`` to ``path`` through a temporary sibling file and return the absolute path.

    An existing file is replaced only when ``overwrite`` is true. ``kind`` names the file
    in error messages.
    """
    target = Path(path).resolve()
    if target.is_dir():
        raise InputError(f"{kind} path is a directory: {target}")
    if target.exists() and not overwrite:
        raise InputError(f"{kind} already exists: {target}; pass --overwrite to replace it")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
        )
    except OSError as error:
        raise ArtifactError(f"cannot write {kind} {target}: {error}") from error
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    except OSError as error:
        Path(temporary).unlink(missing_ok=True)
        raise ArtifactError(f"cannot write {kind} {target}: {error}") from error
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
    return target


def write_report(path: str | Path, html: str, overwrite: bool = False) -> Path:
    """Write an HTML report atomically; an existing file is replaced only with ``overwrite``."""
    return write_file(path, html.encode("utf-8"), overwrite=overwrite, kind="report")
```

Change the module docstring to `"""Atomic writes for generated files such as reports and Rekordbox XML."""`. In `src/setvector/storage/__init__.py`, import `write_file` from `.reports` alongside `write_report` and add `"write_file"` to `__all__`.

- [ ] **Step 4: Implement the renderer**

`src/setvector/rekordbox/write.py`:

```python
"""Render Rekordbox XML and check that it reads back unchanged."""

import xml.etree.ElementTree as ET
from collections.abc import Sequence

from setvector import __version__
from setvector.domain import ArtifactError

from .model import PositionMark, RekordboxTrack
from .read import parse_library

_KIND_TO_TYPE = {"cue": "0", "fade_in": "1", "fade_out": "2", "load": "3", "loop": "4"}
_DECLARATION = b'<?xml version="1.0" encoding="UTF-8"?>\n'


def format_decimal(value: float, places: int) -> str:
    """Format without locale, using ``places`` decimals unless more are needed to round-trip."""
    for digits in range(places, 18):
        text = f"{value:.{digits}f}"
        if float(text) == value:
            return text
    return f"{value:.17f}"


def render_library(tracks: Sequence[RekordboxTrack], playlist_name: str) -> bytes:
    """Return Rekordbox XML with ``tracks`` and one playlist listing them.

    Raises ``ArtifactError`` if the document does not read back to the same tracks.
    """
    tracks = tuple(tracks)
    root = ET.Element("DJ_PLAYLISTS", Version="1.0.0")
    ET.SubElement(root, "PRODUCT", Name="SetVector", Version=__version__, Company="SetVector")
    collection = ET.SubElement(root, "COLLECTION", Entries=str(len(tracks)))
    elements = [_track_element(collection, track) for track in tracks]
    playlists = ET.SubElement(root, "PLAYLISTS")
    folder = ET.SubElement(playlists, "NODE", Type="0", Name="ROOT", Count="1")
    playlist = ET.SubElement(
        folder, "NODE", Name=playlist_name, Type="1", KeyType="0", Entries=str(len(tracks))
    )
    for track in tracks:
        ET.SubElement(playlist, "TRACK", Key=str(track.track_id))
    ET.indent(root, space="  ")
    for element, track in zip(elements, tracks, strict=True):
        for raw in track.extra_elements:
            element.append(ET.fromstring(raw))
    data = _DECLARATION + ET.tostring(root, encoding="utf-8", xml_declaration=False) + b"\n"
    if parse_library(data, "rendered Rekordbox XML").tracks != tracks:
        raise ArtifactError("rendered Rekordbox XML does not read back identically")
    return data


def _track_element(parent: ET.Element, track: RekordboxTrack) -> ET.Element:
    element = ET.SubElement(parent, "TRACK", TrackID=str(track.track_id))
    for name, value in track.attributes:
        element.set(name, value)
    element.set("Location", track.location)
    for marker in track.tempo:
        ET.SubElement(
            element,
            "TEMPO",
            Inizio=format_decimal(marker.start_seconds, 3),
            Bpm=format_decimal(marker.bpm, 2),
            Metro=marker.meter,
            Battito=str(marker.beat_in_bar),
        )
    for mark in track.marks:
        ET.SubElement(element, "POSITION_MARK", _mark_attributes(mark))
    return element


def _mark_attributes(mark: PositionMark) -> dict[str, str]:
    attributes = {
        "Name": mark.name,
        "Type": _KIND_TO_TYPE[mark.kind],
        "Start": format_decimal(mark.start_seconds, 3),
    }
    if mark.end_seconds is not None:
        attributes["End"] = format_decimal(mark.end_seconds, 3)
    attributes["Num"] = "-1" if mark.slot is None else str(mark.slot)
    if mark.colour is not None:
        attributes.update(zip(("Red", "Green", "Blue"), map(str, mark.colour), strict=True))
    return attributes
```

Add `from .write import format_decimal, render_library` to `src/setvector/rekordbox/__init__.py` and both names to `__all__`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_write.py tests/test_storage_reports.py tests/test_application_report.py -v`
Expected: all pass; the report tests are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/setvector/rekordbox src/setvector/storage tests/test_rekordbox_write.py tests/test_storage_reports.py
git commit -m "feat(rekordbox): render importable Rekordbox XML"
```

---

### Task 7: Compare written XML with Rekordbox's export

**Files:**
- Create: `src/setvector/rekordbox/compare.py`
- Modify: `src/setvector/rekordbox/__init__.py`
- Test: `tests/test_rekordbox_compare.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_compare.py`:

```python
"""Findings describe what Rekordbox kept, rounded, changed, dropped or duplicated."""

from dataclasses import replace

from setvector.rekordbox import (
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    compare_libraries,
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_compare.py -v`
Expected: ImportError for `compare_libraries`.

- [ ] **Step 3: Implement the comparison**

`src/setvector/rekordbox/compare.py`:

```python
"""Compare Rekordbox XML that SetVector wrote with Rekordbox's export after importing it."""

import os

from .model import PositionMark, RekordboxLibrary, RekordboxTrack, TempoMarker

EXACT_SECONDS = 0.0005
ROUNDED_SECONDS = 0.005
_SLOT_NAMES = "ABCDEFGH"


def compare_libraries(expected: RekordboxLibrary, actual: RekordboxLibrary) -> list[dict[str, str]]:
    """Return one finding per expected track, marker and mark, plus extra marks found.

    Each finding has ``track``, ``item``, ``result`` (``kept``, ``rounded``, ``changed``,
    ``missing``, ``duplicated`` or ``extra``) and ``detail``. Tracks match by decoded path.
    """
    by_location: dict[str, list[RekordboxTrack]] = {}
    for track in actual.tracks:
        by_location.setdefault(_location_key(track), []).append(track)
    findings: list[dict[str, str]] = []
    for track in expected.tracks:
        name = track.attribute("Name") or track.location
        matches = by_location.get(_location_key(track), [])
        if not matches:
            findings.append(_finding(name, "track", "missing", ""))
            continue
        if len(matches) > 1:
            findings.append(_finding(name, "track", "duplicated", f"{len(matches)} records"))
        for item, result, detail in compare_track(track, matches[0]):
            findings.append(_finding(name, item, result, detail))
    return findings


def compare_track(expected: RekordboxTrack, actual: RekordboxTrack) -> list[tuple[str, str, str]]:
    """Compare one written track with Rekordbox's record of it."""
    results: list[tuple[str, str, str]] = []
    if len(expected.tempo) != len(actual.tempo):
        detail = f"{len(expected.tempo)} written, {len(actual.tempo)} exported"
        results.append(("tempo markers", "changed", detail))
    for index, (want, got) in enumerate(zip(expected.tempo, actual.tempo), 1):
        same_grid = (want.meter, want.beat_in_bar) == (got.meter, got.beat_in_bar)
        if not same_grid or abs(want.bpm - got.bpm) > 0.005:
            detail = f"wrote {_tempo_text(want)}, exported {_tempo_text(got)}"
            results.append((f"tempo {index}", "changed", detail))
        else:
            timing = _timing(want.start_seconds, got.start_seconds)
            results.append(
                (f"tempo {index}", timing, _delta(want.start_seconds, got.start_seconds))
            )
    matched: set[int] = set()
    for want in expected.marks:
        candidates = [i for i, got in enumerate(actual.marks) if _same_mark(want, got)]
        matched.update(candidates)
        item = _mark_label(want)
        if not candidates:
            results.append((item, "missing", ""))
        elif len(candidates) > 1:
            results.append((item, "duplicated", f"{len(candidates)} marks"))
        else:
            results.append((item, *_compare_mark(want, actual.marks[candidates[0]])))
    for index, mark in enumerate(actual.marks):
        if index not in matched:
            detail = f"{mark.kind} at {mark.start_seconds:.3f} s"
            results.append((_mark_label(mark), "extra", detail))
    return results


def _same_mark(want: PositionMark, got: PositionMark) -> bool:
    if want.slot is not None:
        return got.slot == want.slot
    if got.slot is not None or got.kind != want.kind or got.name != want.name:
        return False
    return bool(want.name) or abs(got.start_seconds - want.start_seconds) <= ROUNDED_SECONDS


def _compare_mark(want: PositionMark, got: PositionMark) -> tuple[str, str]:
    differences = []
    if got.name != want.name:
        differences.append(f"name {got.name!r}")
    if got.kind != want.kind:
        differences.append(f"kind {got.kind}")
    if got.colour != want.colour:
        differences.append(f"colour {got.colour}")
    if (want.end_seconds is None) != (got.end_seconds is None) or (
        want.end_seconds is not None and abs(want.end_seconds - got.end_seconds) > ROUNDED_SECONDS
    ):
        differences.append(f"end {got.end_seconds}")
    timing = _timing(want.start_seconds, got.start_seconds)
    if timing == "changed":
        differences.append(f"start {got.start_seconds:.3f}")
    if differences:
        return "changed", ", ".join(differences)
    return timing, _delta(want.start_seconds, got.start_seconds)


def _mark_label(mark: PositionMark) -> str:
    if mark.slot is not None:
        return f"hot {_SLOT_NAMES[mark.slot]}"
    return f"memory {mark.name or format(mark.start_seconds, '.3f')}"


def _timing(expected: float, actual: float) -> str:
    difference = abs(expected - actual)
    if difference <= EXACT_SECONDS:
        return "kept"
    return "rounded" if difference <= ROUNDED_SECONDS else "changed"


def _delta(expected: float, actual: float) -> str:
    return f"{(actual - expected) * 1000:+.1f} ms"


def _tempo_text(marker: TempoMarker) -> str:
    return (
        f"{marker.bpm:.2f} BPM at {marker.start_seconds:.3f} s, "
        f"{marker.meter} beat {marker.beat_in_bar}"
    )


def _location_key(track: RekordboxTrack) -> str:
    path = track.path
    return os.path.normcase(os.path.normpath(str(path))) if path is not None else track.location


def _finding(track: str, item: str, result: str, detail: str) -> dict[str, str]:
    return {"track": track, "item": item, "result": result, "detail": detail}
```

Add `from .compare import compare_libraries, compare_track` to `src/setvector/rekordbox/__init__.py` and both names to `__all__`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_compare.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/rekordbox tests/test_rekordbox_compare.py
git commit -m "feat(rekordbox): compare written XML with Rekordbox exports"
```

---

### Task 8: `rekordbox inspect`

**Files:**
- Create: `src/setvector/application/rekordbox.py`
- Modify: `src/setvector/application/__init__.py`, `src/setvector/cli/__init__.py`
- Test: `tests/test_application_rekordbox.py`, `tests/test_cli.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_application_rekordbox.py`:

```python
"""Summarizing Rekordbox exports and building Rekordbox imports."""

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
```

Append to `tests/test_cli.py`:

```python
REKORDBOX_FIXTURE = Path(__file__).resolve().parent / "data" / "rekordbox-collection.xml"


def test_rekordbox_inspect_prints_a_summary(tmp_path):
    result = run_cli("rekordbox", "inspect", str(REKORDBOX_FIXTURE), cwd=tmp_path)
    assert result.returncode == 0, result.stderr
    summary = json.loads(result.stdout)
    assert summary["track_count"] == 4
    assert summary["product"]["version"] == "7.2.18"


def test_rekordbox_inspect_of_a_missing_file_is_a_usage_error(tmp_path):
    result = run_cli("rekordbox", "inspect", str(tmp_path / "none.xml"), cwd=tmp_path)
    assert result.returncode == 2
    assert "cannot read Rekordbox XML" in result.stderr
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_application_rekordbox.py tests/test_cli.py -k "inspect" -v`
Expected: ImportError for `inspect_library`; the CLI tests fail with exit status 2 and "invalid choice: 'rekordbox'".

- [ ] **Step 3: Implement the summary**

`src/setvector/application/rekordbox.py`:

```python
"""Rekordbox exchange: summarize a collection export and build an import file."""

from collections import Counter
from pathlib import Path

from setvector.rekordbox import profile_for, read_library


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
            locations["file_present" if path.is_file() else "file_missing"] += 1
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
```

In `src/setvector/application/__init__.py`, add `from .rekordbox import inspect_library` and `"inspect_library"` to `__all__`.

- [ ] **Step 4: Add the CLI command**

In `src/setvector/cli/__init__.py`, import `inspect_library` from `setvector.application`, add this handler after `_run_report_index`:

```python
def _run_rekordbox_inspect(args: argparse.Namespace) -> int:
    summary, status = _call(args, lambda: inspect_library(args.xml))
    if status is not None:
        return status
    print(json.dumps(summary, sort_keys=True, ensure_ascii=False))
    return 0
```

and add these lines to `_build_parser` before `return parser`:

```python
    rekordbox_parser = commands.add_parser(
        "rekordbox", help="Read Rekordbox XML exports and write files Rekordbox can import"
    )
    rekordbox_commands = rekordbox_parser.add_subparsers(dest="rekordbox_command", required=True)
    inspect_parser = rekordbox_commands.add_parser(
        "inspect", help="Summarize the tracks, grids and cues in a Rekordbox XML export"
    )
    inspect_parser.add_argument("xml", type=Path, help="Rekordbox collection XML export")
    inspect_parser.set_defaults(handler=_run_rekordbox_inspect, parser=inspect_parser)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_application_rekordbox.py tests/test_cli.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/setvector/application src/setvector/cli tests/test_application_rekordbox.py tests/test_cli.py
git commit -m "feat(rekordbox): summarize Rekordbox exports from the CLI"
```

---

### Task 9: Build Rekordbox imports

**Files:**
- Modify: `src/setvector/application/rekordbox.py`, `src/setvector/application/__init__.py`
- Test: `tests/test_application_rekordbox.py`

- [ ] **Step 1: Write the failing tests**

Extend the imports at the top of `tests/test_application_rekordbox.py` to:

```python
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from setvector.application import build_rekordbox_import, inspect_library, load_cue_requests
from setvector.domain import GridSegment, InputError
from setvector.rekordbox import (
    CapabilityProfile,
    CueRequest,
    TempoMarker,
    location_for_path,
    read_library,
)
from setvector.rekordbox import profile as profile_module
from setvector.storage import ArtifactStore
```

and append:

```python
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
    taken = int(hashlib.sha256(str(audio.resolve()).encode()).hexdigest()[:8], 16)
    library = library_file(tmp_path, [track_xml(taken, audio_file(tmp_path, "Other.mp3"), GRID)])
    outcome = build(library, FakeAnalyzer(beat_this_rhythm), add=[audio])
    (written,) = read_library(outcome.xml_path).tracks
    assert written.track_id == taken + 1
    assert written.location == location_for_path(audio.resolve())
    assert written.attribute("Name") == "New Track #1"
    assert written.attribute("AverageBpm") == "120.00"
    assert outcome.receipt["unverified_override"] is False


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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_application_rekordbox.py -v`
Expected: ImportError for `build_rekordbox_import`.

- [ ] **Step 3: Implement the import builder**

Replace `src/setvector/application/rekordbox.py` with:

```python
"""Rekordbox exchange: summarize a collection export and build an import file."""

import json
import os
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from setvector.domain import AnalysisConfig, InputError, RhythmAnalysis
from setvector.rekordbox import (
    CapabilityProfile,
    CueOutcome,
    CueRequest,
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    location_for_path,
    place_cues,
    profile_for,
    read_library,
    render_library,
    tempo_markers_for,
)
from setvector.storage import ArtifactStore, strict_json_loads, write_file

from .analyze import analyze_track

_PROBE_HINT = "run scripts/rekordbox_probe.py to qualify it, or pass --unverified-rekordbox"


@dataclass(frozen=True, slots=True)
class RekordboxExportOutcome:
    """Where the import file and its receipt were written, and what they record."""

    xml_path: Path
    receipt_path: Path
    written_count: int
    receipt: Mapping[str, object]


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
            locations["file_present" if path.is_file() else "file_missing"] += 1
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


def load_cue_requests(path: str | Path) -> dict[Path, tuple[CueRequest, ...]]:
    """Read ``{"tracks": [{"path": ..., "cues": [...]}]}`` cue requests from JSON."""
    try:
        data = strict_json_loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise InputError(f"cannot read cue requests {path}: {error}") from error
    if (
        not isinstance(data, dict)
        or set(data) != {"tracks"}
        or not isinstance(data["tracks"], list)
    ):
        raise InputError(f"{path} must be an object with a tracks array")
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
            requests[Path(entry["path"])] = tuple(CueRequest.from_dict(c) for c in entry["cues"])
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
    overrides cue limits only. A JSON receipt is written next to the XML.
    """
    xml_target = Path(output).resolve()
    receipt_target = xml_target.with_name(xml_target.name + ".receipt.json")
    for target in (xml_target, receipt_target):
        if target.exists() and not overwrite:
            raise InputError(f"{target} already exists; pass --overwrite to replace it")
    library = (
        read_library(library_path) if library_path is not None else RekordboxLibrary(None, None, ())
    )
    version_profile = profile_for(library.product_version)
    limits = profile or version_profile
    in_library: dict[str, RekordboxTrack] = {}
    for track in library.tracks:
        if track.path is not None:
            in_library.setdefault(_key(track.path), track)
    added: dict[str, Path] = {}
    for item in add:
        path = Path(item).resolve()
        if not path.is_file():
            raise InputError(f"added audio file not found: {path}")
        added.setdefault(_key(path), path)
    requests: dict[str, tuple[CueRequest, ...]] = {}
    for item, items in (cues or {}).items():
        key = _key(item)
        if key in requests:
            raise InputError(f"cue requests name {item} twice")
        if key not in in_library and key not in added:
            raise InputError(
                f"cue requests name a file that is neither in the library nor added: {item}"
            )
        requests[key] = tuple(items)
    selected = [
        (key, track) for key, track in in_library.items() if key in added or key in requests
    ]
    selected += [(key, None) for key in added if key not in in_library]
    used_ids = {track.track_id for track in library.tracks}
    records: list[dict[str, object]] = []
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
        "rekordbox_version": library.product_version,
        "profile_verified": version_profile.verified,
        "unverified_override": bool(changed_library_tracks) and not version_profile.verified,
        "output": str(xml_target),
        "written_count": len(written),
        "tracks": records,
    }
    xml_path = write_file(xml_target, data, overwrite=overwrite, kind="Rekordbox XML")
    text = json.dumps(receipt, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    receipt_path = write_file(
        receipt_target, text.encode("utf-8"), overwrite=overwrite, kind="receipt"
    )
    return RekordboxExportOutcome(xml_path, receipt_path, len(written), receipt)


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
    elif not path.is_file():
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
    asset_id: str,
    bpm: float | None,
    tempo: tuple[TempoMarker, ...],
    marks: tuple[PositionMark, ...],
    used_ids: set[int],
) -> RekordboxTrack:
    track_id = int(asset_id[:8], 16) or 1
    while track_id in used_ids:
        track_id = track_id % 0xFFFFFFFF + 1
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


def _key(path: str | Path) -> str:
    return os.path.normcase(str(Path(path).resolve()))
```

In `src/setvector/application/__init__.py`, import `RekordboxExportOutcome`, `build_rekordbox_import`, `inspect_library` and `load_cue_requests` from `.rekordbox`, and add the four names to `__all__` in sorted order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_application_rekordbox.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/application tests/test_application_rekordbox.py
git commit -m "feat(rekordbox): build Rekordbox imports with grids and cues"
```

---

### Task 10: `rekordbox export` and the offline check

**Files:**
- Modify: `src/setvector/cli/__init__.py`
- Test: `tests/test_offline_analysis.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_offline_analysis.py`:

```python
def test_rekordbox_export_works_with_network_sockets_blocked(
    tmp_path, tone_path, config_path, offline_environment
):
    library = tmp_path / "collection.xml"
    library.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">'
        '<PRODUCT Name="rekordbox" Version="7.2.19" Company="AlphaTheta"/>'
        '<COLLECTION Entries="0"/></DJ_PLAYLISTS>',
        encoding="utf-8",
    )
    cues = tmp_path / "cues.json"
    cue = {"label": "Start", "start_seconds": 0.5, "hot": False}
    cues.write_text(
        json.dumps({"tracks": [{"path": str(tone_path), "cues": [cue]}]}), encoding="utf-8"
    )
    output = tmp_path / "import" / "setvector.xml"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "setvector",
            "rekordbox",
            "export",
            str(library),
            "--config",
            str(config_path),
            "--workspace",
            str(tmp_path / "workspace"),
            "--output",
            str(output),
            "--add",
            str(tone_path),
            "--cues",
            str(cues),
        ],
        cwd=tmp_path,
        env=offline_environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["written_count"] == 1
    assert "network access attempted" not in result.stderr
    assert 'Name="SV Start"' in output.read_text(encoding="utf-8")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_offline_analysis.py -k rekordbox -v`
Expected: FAIL with exit status 2 and "invalid choice: 'export'".

- [ ] **Step 3: Add the CLI command**

In `src/setvector/cli/__init__.py`, import `build_rekordbox_import` and `load_cue_requests` from `setvector.application`, add this handler after `_run_rekordbox_inspect`:

```python
def _run_rekordbox_export(args: argparse.Namespace) -> int:
    try:
        config = _load_config(args.config)
    except (OSError, ValueError, TypeError) as error:
        args.parser.error(f"cannot load configuration {args.config}: {error}")
    cues = None
    if args.cues is not None:
        cues, status = _call(args, lambda: load_cue_requests(args.cues))
        if status is not None:
            return status
    outcome, status = _call(
        args,
        lambda: build_rekordbox_import(
            args.xml,
            config=config,
            store=ArtifactStore(args.workspace),
            output=args.output,
            add=args.add,
            cues=cues,
            allow_unverified=args.unverified_rekordbox,
            overwrite=args.overwrite,
        ),
    )
    if status is not None:
        return status
    result = {
        "xml_path": str(outcome.xml_path),
        "receipt_path": str(outcome.receipt_path),
        "written_count": outcome.written_count,
        "unverified_override": outcome.receipt["unverified_override"],
    }
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    for record in outcome.receipt["tracks"]:
        grid = record["grid"]
        if grid["action"] == "omitted":
            reasons = "; ".join(grid["reasons"])
            print(
                f"setvector: warning: {record['path']}: no grid written: {reasons}", file=sys.stderr
            )
        for cue in record["cues"]:
            if cue["status"] in ("no_free_slot", "over_memory_limit"):
                problem = cue["status"].replace("_", " ")
                print(
                    f"setvector: warning: {record['path']}: cue {cue['label']!r} not written: "
                    f"{problem}",
                    file=sys.stderr,
                )
    return 0
```

and add these lines to `_build_parser` after the `inspect` parser:

```python
export_parser = rekordbox_commands.add_parser(
    "export",
    help="Write Rekordbox XML that adds SetVector grids and cues",
    description=(
        "Write an importable Rekordbox XML file and a receipt. Existing grids and the "
        "user's cues are never replaced."
    ),
)
export_parser.add_argument("xml", type=Path, help="Rekordbox collection XML export")
export_parser.add_argument(
    "--config", type=Path, required=True, help="Analysis configuration JSON file"
)
export_parser.add_argument(
    "--workspace", type=Path, required=True, help="Directory for analysis artifacts"
)
export_parser.add_argument("--output", type=Path, required=True, help="Rekordbox XML file to write")
export_parser.add_argument(
    "--add",
    type=Path,
    nargs="+",
    action="extend",
    default=[],
    metavar="AUDIO",
    help="Audio files to add, or library tracks to give a grid if they lack one",
)
export_parser.add_argument("--cues", type=Path, help="JSON file of cue requests per audio file")
export_parser.add_argument(
    "--unverified-rekordbox",
    action="store_true",
    help="Update library tracks although this Rekordbox version has not been qualified",
)
export_parser.add_argument("--overwrite", action="store_true", help="Replace existing output files")
export_parser.set_defaults(handler=_run_rekordbox_export, parser=export_parser)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_offline_analysis.py tests/test_cli.py -v`
Expected: all pass. The export test runs real analysis on the 3 s tone; stderr contains a "no grid written" warning because the tone has too few beats for a grid.

- [ ] **Step 5: Commit**

```bash
git add src/setvector/cli tests/test_offline_analysis.py
git commit -m "feat(rekordbox): export Rekordbox imports from the CLI"
```

---

### Task 11: Compatibility probe

**Files:**
- Create: `scripts/rekordbox_probe.py`
- Test: `tests/test_rekordbox_probe.py`

- [ ] **Step 1: Write the failing tests**

`tests/test_rekordbox_probe.py`:

```python
"""The Rekordbox probe builds deterministic drum tracks and stage cue requests."""

import runpy
from pathlib import Path

import numpy as np
import pytest

from setvector.rekordbox import CueRequest

PROBE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "rekordbox_probe.py"))


def test_drum_track_places_downbeats_on_each_tempo_section():
    samples, downbeats = PROBE["drum_track"](((120.0, 2), (128.0, 2)), 0.5)
    assert samples.shape[1] == 2
    assert samples.dtype == np.float32
    assert downbeats == pytest.approx([0.5, 2.5, 4.5, 4.5 + 4 * 60 / 128])


def test_stage_two_moves_removes_and_adds_setvector_cues(tmp_path):
    downbeats = {name: [float(i) for i in range(50)] for name in PROBE["TRACKS"]}
    first = PROBE["stage_requests"](tmp_path, downbeats, 1)
    second = PROBE["stage_requests"](tmp_path, downbeats, 2)
    one = tmp_path / "probe-1-constant-120.wav"
    before = {request.label: request for request in first[one]}
    after = {request.label: request for request in second[one]}
    assert "Hot B" in before and "Hot B" not in after
    assert after["Hot A"].start_seconds != before["Hot A"].start_seconds
    assert after["Hot N"].preferred_slot == 7
    assert "Mem 01b" in after and "Mem 01" not in after
    assert all(isinstance(r, CueRequest) for requests in first.values() for r in requests)
    two = tmp_path / "probe-2-tempo-change.wav"
    assert {request.preferred_slot for request in first[two]} == set(range(8))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_rekordbox_probe.py -v`
Expected: FAIL: `scripts/rekordbox_probe.py` does not exist.

- [ ] **Step 3: Write the probe**

`scripts/rekordbox_probe.py`:

```python
"""Qualify a Rekordbox version's XML import with synthetic drum tracks.

Run ``generate``, import ``stage1.xml`` in Rekordbox as CHECKLIST.md describes, then run
``stage2`` and ``check``. The probe never touches a real track.
"""

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import soundfile as sf

from setvector.application import build_rekordbox_import
from setvector.domain import AnalysisConfig
from setvector.rekordbox import CapabilityProfile, CueRequest, compare_libraries, read_library
from setvector.storage import ArtifactStore

SAMPLE_RATE = 44_100
CONFIG = Path(__file__).resolve().parents[1] / "examples" / "analysis-config.json"
PROBE_PROFILE = CapabilityProfile((), 8, 100, None, None, None)
TRACKS = {
    "probe-1-constant-120.wav": (((120.0, 44),), 0.5),
    "probe-2-tempo-change.wav": (((120.0, 22), (128.0, 24)), 0.5),
    "probe-3-late-start.wav": (((124.0, 44),), 2.3),
}
ONE, TWO, THREE = TRACKS
COLOURS = (
    (255, 55, 111),
    (69, 172, 219),
    (48, 90, 255),
    (40, 226, 20),
    (224, 100, 27),
    (165, 225, 22),
    (180, 50, 255),
    (255, 18, 123),
)
CHECKLIST = """# Rekordbox probe

Probe folder: `{folder}`

1. Rekordbox → Preferences → View → Layout: enable **rekordbox xml**.
2. Preferences → Advanced → Database → rekordbox xml → Imported Library: choose `stage1.xml`.
3. Write down the Rekordbox version, Windows version and Preferences → Analysis settings
   (auto analysis, BPM range, dynamic analysis, CUE analysis).
4. In the browser tree open **rekordbox xml → All Tracks**, select the three probe tracks,
   right-click → **Import To Collection**. Write down any prompt text. Wait for analysis.
5. In Collection, play hot cue A and the first memory cue of `probe-1-constant-120`.
   Note whether each lands on the crash at the start of a bar.
6. On `probe-1-constant-120`, set hot cue **G** by hand on any beat and add one memory cue
   by hand.
7. File → Export Collection in xml format → save as `export-1.xml` in the probe folder.
8. Run `python scripts/rekordbox_probe.py stage2 "{folder}" --library "{folder}/export-1.xml"`.
9. Point Imported Library to `stage2.xml`, open **rekordbox xml → All Tracks**, select
   `probe-1-constant-120` → **Import To Collection**. Write down any prompt. Import it a
   second time.
10. Export the collection again as `export-2.xml` in the probe folder.
11. Run `python scripts/rekordbox_probe.py check "{folder}" --stage1 "{folder}/export-1.xml"
    --stage2 "{folder}/export-2.xml"` and keep `probe-results.json`.
12. Remove the three probe tracks from the Collection.

In stage 1, the hand-made cues from step 6 appear as `extra`. In stage 2 they are part of
what SetVector wrote, so `missing` or `duplicated` there means Rekordbox lost or doubled them.
"""


def drum_track(sections, lead_in):
    """Return stereo float32 samples and downbeat times for ``(bpm, bars)`` sections.

    Kick on every beat, snare on 2 and 4, off-beat hats, a bass note on every bar and a
    crash every fourth bar, after ``lead_in`` seconds of silence.
    """
    beats = []
    time = lead_in
    for bpm, bars in sections:
        for _ in range(bars * 4):
            beats.append(time)
            time += 60.0 / bpm
    size = int(SAMPLE_RATE * (time + 1.0))
    signal = np.zeros(size)
    rng = np.random.default_rng(7)

    def put(sound, at, gain):
        start = int(round(at * SAMPLE_RATE))
        signal[start : start + sound.size] += gain * sound[: size - start]

    def decay(seconds, tau):
        return np.exp(-np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE / tau)

    t = np.arange(int(0.2 * SAMPLE_RATE)) / SAMPLE_RATE
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    snare = rng.standard_normal(int(0.15 * SAMPLE_RATE)) * decay(0.15, 0.04)
    hat = rng.standard_normal(int(0.04 * SAMPLE_RATE)) * decay(0.04, 0.01)
    crash = rng.standard_normal(SAMPLE_RATE) * decay(1.0, 0.3)
    for index, beat in enumerate(beats):
        put(kick, beat, 0.9)
        if index % 4 in (1, 3):
            put(snare, beat, 0.5)
        following = beats[index + 1] if index + 1 < len(beats) else time
        put(hat, (beat + following) / 2, 0.2)
    downbeats = beats[::4]
    for bar, downbeat in enumerate(downbeats):
        end = downbeats[bar + 1] if bar + 1 < len(downbeats) else time
        bar_t = np.arange(int((end - downbeat) * SAMPLE_RATE)) / SAMPLE_RATE
        root = (55.0, 43.65, 49.0, 41.2)[bar % 4]
        put(np.sin(2 * np.pi * root * bar_t) * np.minimum(1, bar_t / 0.01), downbeat, 0.3)
        if bar % 4 == 0:
            put(crash, downbeat, 0.3)
    signal = 0.9 * signal / np.abs(signal).max()
    return np.stack([signal, signal], axis=1).astype(np.float32), downbeats


def stage_requests(folder, downbeats, stage):
    """Cue requests per probe track; stage 2 moves, removes, adds and renames cues."""
    first, second, third = (downbeats[name] for name in TRACKS)
    one = [
        CueRequest(f"Hot {'ABCDEF'[i]}", first[2 * i], True, preferred_slot=i, colour=COLOURS[i])
        for i in range(6)
    ]
    one += [
        CueRequest(f"Mem {i + 1:02d}", first[12 + i], False, colour=COLOURS[i % 8])
        for i in range(12)
    ]
    one.append(CueRequest("Loop", first[26], False, kind="loop", end_seconds=first[27]))
    if stage == 2:
        one = [request for request in one if request.label != "Hot B"]
        one = [
            replace(request, start_seconds=first[9])
            if request.label == "Hot A"
            else replace(request, label="Mem 01b")
            if request.label == "Mem 01"
            else request
            for request in one
        ]
        one.append(CueRequest("Hot N", first[30], True, preferred_slot=7, colour=COLOURS[7]))
    two = [
        CueRequest(f"Hot {'ABCDEFGH'[i]}", second[5 * i], True, preferred_slot=i, colour=COLOURS[i])
        for i in range(8)
    ]
    three = [
        CueRequest("Hot A", third[0], True, preferred_slot=0, colour=COLOURS[0]),
        CueRequest("Mem 01", third[0], False),
        CueRequest("Mem 09", third[8], False),
    ]
    return {folder / ONE: tuple(one), folder / TWO: tuple(two), folder / THREE: tuple(three)}


def _export(folder, library, name, requests):
    config = AnalysisConfig.from_dict(json.loads(CONFIG.read_text(encoding="utf-8")))
    return build_rekordbox_import(
        library,
        config=config,
        store=ArtifactStore(folder / "workspace"),
        output=folder / name,
        add=[folder / track for track in TRACKS],
        cues=requests,
        allow_unverified=True,
        overwrite=True,
        profile=PROBE_PROFILE,
        playlist_name="SetVector probe",
    )


def generate(args) -> int:
    folder = args.folder.resolve()
    folder.mkdir(parents=True, exist_ok=True)
    downbeats = {}
    for name, (sections, lead_in) in TRACKS.items():
        samples, downbeats[name] = drum_track(sections, lead_in)
        sf.write(folder / name, samples, SAMPLE_RATE, subtype="PCM_16")
    probe = {"downbeats": downbeats}
    (folder / "probe.json").write_text(json.dumps(probe, indent=2) + "\n", encoding="utf-8")
    outcome = _export(folder, None, "stage1.xml", stage_requests(folder, downbeats, 1))
    failed = [r["path"] for r in outcome.receipt["tracks"] if r["grid"]["action"] != "added"]
    if failed:
        print(
            f"no Beat This! grid for {', '.join(failed)}; see {outcome.receipt_path}",
            file=sys.stderr,
        )
        return 1
    (folder / "CHECKLIST.md").write_text(CHECKLIST.format(folder=folder), encoding="utf-8")
    print(f"wrote {outcome.xml_path}; follow {folder / 'CHECKLIST.md'}")
    return 0


def stage2(args) -> int:
    folder = args.folder.resolve()
    downbeats = json.loads((folder / "probe.json").read_text(encoding="utf-8"))["downbeats"]
    outcome = _export(folder, args.library, "stage2.xml", stage_requests(folder, downbeats, 2))
    print(f"wrote {outcome.xml_path} with {outcome.written_count} track(s)")
    return 0


def check(args) -> int:
    folder = args.folder.resolve()
    results = {}
    for stage, export in (("stage1", args.stage1), ("stage2", args.stage2)):
        if export is None:
            continue
        findings = compare_libraries(read_library(folder / f"{stage}.xml"), read_library(export))
        results[stage] = findings
        print(f"== {stage}")
        for finding in findings:
            detail = f" ({finding['detail']})" if finding["detail"] else ""
            print(f"{finding['track']}: {finding['item']}: {finding['result']}{detail}")
    text = json.dumps(results, indent=2, ensure_ascii=False) + "\n"
    (folder / "probe-results.json").write_text(text, encoding="utf-8")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    generate_parser = commands.add_parser("generate", help="Write drum tracks and stage1.xml")
    generate_parser.add_argument("folder", type=Path)
    stage2_parser = commands.add_parser("stage2", help="Write stage2.xml from export-1.xml")
    stage2_parser.add_argument("folder", type=Path)
    stage2_parser.add_argument("--library", type=Path, required=True)
    check_parser = commands.add_parser("check", help="Compare Rekordbox exports with the stages")
    check_parser.add_argument("folder", type=Path)
    check_parser.add_argument("--stage1", type=Path, required=True)
    check_parser.add_argument("--stage2", type=Path)
    args = parser.parse_args(argv)
    return {"generate": generate, "stage2": stage2, "check": check}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_rekordbox_probe.py -v`
Expected: all pass.

- [ ] **Step 5: Generate a probe folder once to confirm real grids**

Run: `python scripts/rekordbox_probe.py generate "$env:TEMP\setvector-probe-dryrun"`
Expected: `wrote ...\stage1.xml; follow ...\CHECKLIST.md`. If it reports "no Beat This! grid", read the receipt's `grid.reasons`, then adjust `TRACKS` (more bars) and rerun. Delete the dry-run folder afterwards.

- [ ] **Step 6: Commit**

```bash
git add scripts/rekordbox_probe.py tests/test_rekordbox_probe.py
git commit -m "feat(rekordbox): add a Rekordbox import qualification probe"
```

---

### Task 12: Documentation and full checks

**Files:**
- Modify: `docs/architecture.md`, `docs/development.md`, `README.md`
- Create: `docs/rekordbox-compatibility.md`

- [ ] **Step 1: Architecture module table**

In `docs/architecture.md`, add this row to the "Modules and responsibilities" table after the `cli` row:

```markdown
| `rekordbox` | Read Rekordbox XML exports and render importable XML projections of SetVector grids and cues | Optional integration; core analysis never imports it. Never replaces existing grids or user cues |
```

- [ ] **Step 2: Development guide section**

In `docs/development.md`, add a section `## Rekordbox` after `## Report collections`:

````markdown
## Rekordbox

SetVector reads a Rekordbox collection export (File → Export Collection in xml format) and
writes an XML file for Rekordbox's own import. It never writes Rekordbox's database.

```powershell
setvector rekordbox inspect collection.xml
setvector rekordbox export collection.xml --config examples/analysis-config.json `
  --workspace workspace --output import/setvector.xml --add "D:/Music/New Track.mp3"
```

`export` writes the complete record of every track it changes, plus a receipt
(`setvector.xml.receipt.json`) listing what was added, left out and why.

- A track that already has a Rekordbox grid keeps it unchanged. A track without one gets
  SetVector's grid only when Beat This! produced a reliable grid with bars.
- `--cues cues.json` adds cues: `{"tracks": [{"path": "...", "cues": [{"label": "Drop",
  "start_seconds": 61.935, "hot": true}]}]}`. Optional fields are `kind` (`cue` or `loop`),
  `end_seconds` (loops), `preferred_slot` (0–7 for hot cues A–H) and `colour` (`[r, g, b]`).
  Cues are written with the name prefix `SV `. A track's `SV ` cues are replaced on each
  export that names the track; other cues are never changed. Hot cues use free slots only.
- Updating a track already in the collection requires a Rekordbox version qualified with
  `scripts/rekordbox_probe.py` (see [Rekordbox compatibility](rekordbox-compatibility.md)),
  or `--unverified-rekordbox`.

To import, enable Preferences → View → Layout → rekordbox xml, choose the file under
Preferences → Advanced → Database → rekordbox xml, then select the tracks under
rekordbox xml → All Tracks and choose Import To Collection.
````

- [ ] **Step 3: Compatibility document**

Create `docs/rekordbox-compatibility.md`:

```markdown
# Rekordbox compatibility

SetVector writes Rekordbox XML only for behaviour measured with `scripts/rekordbox_probe.py`
on a named Rekordbox version. Each qualified version has a profile in
`src/setvector/rekordbox/profile.py`.

No version is qualified yet. Until one is, updating tracks already in the collection
requires `--unverified-rekordbox`, and SetVector assumes 8 hot cue slots and 10 memory
cues per track.

To qualify a version, run `python scripts/rekordbox_probe.py generate <folder>` and follow
the generated `CHECKLIST.md`.
```

- [ ] **Step 4: README pointer**

In `README.md`, after the paragraph ending with "[Report collections](docs/development.md#report-collections).", add:

```markdown
To bring SetVector grids and cues into Rekordbox, run `setvector rekordbox export` on a
Rekordbox collection export. Existing grids and your own cues are never replaced. See
[Rekordbox](docs/development.md#rekordbox).
```

- [ ] **Step 5: Run every project check**

Run: `python -m pytest -q`, `python -m ruff check .`, `python -m ruff format --check .`
Expected: all tests pass; Ruff clean. Fix and rerun if not.

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs: describe the Rekordbox bridge and its qualification"
```

---

### Task 13: Qualify Rekordbox 7.2.19 with the user

This task needs the user at Rekordbox. It changes only the profile and the compatibility document.

- [ ] **Step 1: Generate the probe** in a folder outside the repository, for example `C:\Users\aryan\Music\setvector-probe`: `python scripts/rekordbox_probe.py generate C:\Users\aryan\Music\setvector-probe`. Give the user the generated `CHECKLIST.md` and wait while they complete steps 1–7.
- [ ] **Step 2: Run `stage2`** when the user has `export-1.xml`, then wait while they complete checklist steps 9–10.
- [ ] **Step 3: Run `check`** and read `probe-results.json` with the user's notes (prompts, settings, audible cue positions).
- [ ] **Step 4: Record the profile.** Set `PROFILES` in `src/setvector/rekordbox/profile.py` to one `CapabilityProfile` for `("7.2.19",)`: `hot_cue_slots` = the number of hot slots A–H found `kept`/`rounded` on `probe-2-tempo-change`; `memory_cue_limit` = the number of `SV Mem` cues kept on `probe-1-constant-120` in stage 1 (12 if all survived); `memory_cue_colours` = whether memory cue colours were kept; `reimport` = `replace` if stage 2 shows SetVector's changes applied with no duplicates, `merge` if old and new cues both remain, `ignore` if stage 2 changes are missing; `grids_survive_analysis` = whether stage 1 tempo findings are `kept`/`rounded`. Add a test to `tests/test_rekordbox_cues.py` asserting `profile_for("7.2.19").verified`.
- [ ] **Step 5: Document the result.** Replace the "No version is qualified yet" paragraph of `docs/rekordbox-compatibility.md` with a table of the measured behaviours for 7.2.19 on Windows 11, the analysis settings used, and any prompts. If stage 2 shows lost or duplicated user cues, stop and revise the design with the user before recording a profile.
- [ ] **Step 6: Run all checks and commit** with `feat(rekordbox): qualify Rekordbox 7.2.19`.
