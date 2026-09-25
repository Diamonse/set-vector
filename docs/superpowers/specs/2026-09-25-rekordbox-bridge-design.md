# Rekordbox Bridge Design

## Goal

Read the user's Rekordbox XML export as reference data, and write a Rekordbox XML file that adds SetVector's beat grids and cues without damaging anything the user already has. The supported exchange route is Rekordbox's XML import; SetVector never writes Rekordbox's database.

This is the second of three sub-projects toward Rekordbox integration:

1. **Rhythm engine:** beat grids with real downbeats ([design](2026-09-23-rhythm-engine-design.md)).
2. **Rekordbox bridge** (this document).
3. **Phrase detection and mix-in/out suggestions:** computed on the best available bar grid (Rekordbox, then Beat This!, then fallback) and exported as memory cues and hot cues through this bridge.

The user's rules for writing:

- Never replace an existing Rekordbox grid. SetVector writes a grid only for a track without one.
- Hot cues fill empty slots only. SetVector replaces only cues it labelled itself, and reports tracks with no free slot.
- Phrases become named memory cues, coloured if Rekordbox imports memory cue colours. Rekordbox XML cannot set Rekordbox's own phrase strip.

## Evidence

The user's collection export (`collection_1.xml`, Rekordbox 7.2.18; the user now runs 7.2.19) and the comparison snapshot in [`reports/rekordbox-reference/`](../../../reports/rekordbox-reference/README.md) show:

- 185 records: 150 local songs (MP3), 30 Rekordbox sampler WAVs, and 5 SoundCloud streaming tracks whose `Location` is `file://localhost/soundcloud:tracks:<id>`.
- Every local song already has a Rekordbox grid: 116 with one `TEMPO` marker, 34 with several, and 7 with 276–748 markers (dynamic analysis). Every marker is `Metro="4/4"`. Under the rules above, SetVector would write no grid to any song in this library; grid writing matters only for tracks Rekordbox has not analyzed.
- No local song has a cue. All 19 cues belong to streaming tracks or samples. Hot cues use `Num` 0–7, so the export itself confirms slots A–H map to 0–7. Hot cues carry `Red`/`Green`/`Blue`; the one memory cue (`Num="-1"`) carries no colour. All cue names are empty.
- `Inizio` and `Start` have three decimals (milliseconds) and `Bpm` two decimals. Locations are percent-encoded (`%20`, `%26`, `%27` observed).
- SetVector and Rekordbox agree on beats for 107 of 142 compared songs at ±40 ms, but 26 Beat This! songs disagree on downbeats, 7 by about two beats for nearly the whole song. Rekordbox grids are therefore the preferred bar grid for phrase detection, as decided, though not verified ground truth.

The [Rekordbox research notes](../../../research_notes/SetVector%20desktop%20implementation%20order/rekordbox_capabilities.md) establish that XML import is documented, but not what Rekordbox does when it re-imports a track already in the collection (replace, merge, or ignore), whether hot cues D–H and memory cue colours import, or whether auto-analysis overwrites an imported grid. The compatibility probe below measures these on the user's Rekordbox version before SetVector writes into existing tracks.

## Approach

For each track SetVector changes, the output XML contains the complete desired state of that track: the user's record exactly as exported (all attributes, every `TEMPO`, every `POSITION_MARK`) plus SetVector's additions. Whether Rekordbox replaces or merges a re-imported track, the result is correct; the probe shows whether merging duplicates cues. Tracks SetVector does not change are omitted from the output.

Rejected alternatives: writing only SetVector's additions deletes the user's cues if Rekordbox replaces on re-import; writing Rekordbox's encrypted `master.db` through `pyrekordbox` depends on undocumented storage that changes between releases.

## Components

A new package `src/setvector/rekordbox/` is an optional integration layer: it depends on `domain` and the standard library, and core analysis does not depend on it. It works offline and adds no dependencies.

| File | Responsibility |
|---|---|
| `rekordbox/model.py` | Immutable, validated types. `TempoMarker(start_seconds, bpm, meter, beat_in_bar)`. `PositionMark(name, kind, start_seconds, end_seconds, slot, colour)` where `kind` is `cue` (XML `Type="0"`) or `loop` (`Type="4"`), `end_seconds` is present only for loops, `slot` is `None` for a memory cue (`Num="-1"`) or 0–7 for hot cues A–H, and `colour` is an optional RGB triple. `RekordboxTrack(track_id, location, path, attributes, tempo, marks, extra_elements)`: `location` is the raw URI, `path` the decoded local `Path` or `None` for non-file locations, `attributes` every other `TRACK` attribute in document order, kept verbatim, and `extra_elements` any child elements other than `TEMPO` and `POSITION_MARK`, kept as serialized XML. `RekordboxLibrary(product_name, product_version, tracks)`. |
| `rekordbox/read.py` | `read_library(path) -> RekordboxLibrary`. Parses with the standard library's `xml.etree.ElementTree` (Python 3.11's expat rejects entity-expansion attacks). Decodes `file://localhost/` URIs with `urllib.parse.unquote`. Unknown child elements of `TRACK` go to `extra_elements` so a full-state record can reproduce them. Playlists are not read. |
| `rekordbox/grid.py` | `expand_tempo(markers, duration_seconds) -> (beats, bar_positions)`, promoted from Codex's `marker_grid`: each marker is a beat anchor; beats advance by `60 / Bpm` to the next marker or the end; `Battito` advances modulo the `Metro` numerator; a later marker resets timing and phase; a beat predicted within a quarter of the local interval (at most 120 ms) before the next marker is dropped as a rounding duplicate; nothing is extrapolated before the first marker. `tempo_markers_for(rhythm) -> tuple[TempoMarker, ...]` converts a SetVector grid: one marker per `GridSegment` (`Inizio` = `start_seconds`, `Bpm` = `bpm`, `Battito` = `first_bar_position`, `Metro` = `<modal bar length>/4`), with extra markers inside a segment wherever rounding `Bpm` to two decimals and `Inizio` to milliseconds would move any beat more than 5 ms from SetVector's grid. It accepts only a reliable `beat_this` rhythm; fallback grids have no bar positions and are never given invented downbeats. |
| `rekordbox/cues.py` | Pure placement policy. `CueRequest(label, kind, start_seconds, end_seconds, hot, preferred_slot, colour)`. `place_cues(existing, requests, profile) -> CuePlacement` returns the final marks and one outcome per request (`placed`, `moved_slot`, `no_free_slot`, `over_memory_limit`). A mark belongs to SetVector when its name starts with `SV `; the writer adds that prefix to every label. Every export replaces all of a track's SetVector marks with the new requests and never changes user marks. A hot cue goes to its preferred slot when free, otherwise to the lowest free slot; SetVector-owned slots count as free. A memory cue is dropped when the track would exceed the profile's memory cue limit. |
| `rekordbox/write.py` | `write_library(tracks, path, playlist_name)`. Builds the document with `ElementTree` (never string concatenation): `DJ_PLAYLISTS Version="1.0.0"`, `PRODUCT Name="SetVector"`, `COLLECTION` with the given tracks, and `PLAYLISTS` with one playlist listing them by `TrackID`. Numbers are formatted without locale: `Inizio`/`Start`/`End` with three decimals, `Bpm` and `AverageBpm` with two. An existing track keeps its raw `location` string, because Rekordbox may match tracks by it; only a new track's path is encoded, as `file://localhost/` + `urllib.parse.quote` of the forward-slash path, keeping the drive colon. Output is byte-identical for identical input. After writing to a temporary file, it reads the file back with `read_library`, checks it equals the input, and renames it into place. |
| `rekordbox/profile.py` | Capability profiles per verified Rekordbox version: hot cue slot count, memory cue limit, whether memory cue colours import, re-import behaviour, and whether imported grids survive analysis. Filled from the probe results. Until then a default profile assumes 8 hot cue slots and 10 memory cues and is marked unverified. |
| `application/rekordbox.py` | `inspect_library(xml_path) -> LibrarySummary` and `build_rekordbox_import(...) -> RekordboxExportOutcome`, described below. |
| `cli/__init__.py` | `setvector rekordbox inspect` and `setvector rekordbox export`. |
| `scripts/rekordbox_probe.py` | The compatibility probe. |

`docs/architecture.md` gains a `rekordbox` row in the module table: "Read Rekordbox XML exports and write importable XML projections of SetVector results. Optional integration; core analysis never depends on it."

The rhythm artifact does not gain a `rekordbox` source, which the rhythm engine design proposed earlier. A rhythm artifact is a content-addressed analysis of audio; a Rekordbox grid is user data that changes whenever the user edits it. Phrase detection reads Rekordbox grids through `read_library` and `expand_tempo` and chooses between them and the rhythm artifact itself. Codex's rhythm evaluator uses the same two functions instead of its own parser.

## Application and CLI flow

**`setvector rekordbox inspect <xml>`** prints a JSON summary: the product version, track counts by kind (local file, missing file, non-file location), grid type (none, one marker, several), meters in use, and hot and memory cue counts. It reads no audio.

**`setvector rekordbox export <xml> --config <json> --workspace <dir> --output <file> [--add <audio>...] [--cues <json>] [--overwrite]`** calls `build_rekordbox_import`:

1. Read the library. For each `--add` file, find a library track whose decoded path equals it (compared with `os.path.normcase` after `resolve`); a match makes it an existing track, otherwise it is new.
2. For each existing track with a cue request, and each new track, confirm the file exists and run the cached `analyze_track` to get its rhythm. Non-file and missing locations are skipped with a reason.
3. Grid: an existing track's markers are copied unchanged, whatever they are. A track without markers gets `tempo_markers_for(rhythm)` when the rhythm is a reliable `beat_this` grid; otherwise its grid is omitted with the rhythm's reasons.
4. Cues: `place_cues` with the track's existing marks, its requests, and the profile.
5. A track with nothing to add is left out of the output. A new track's record has `TrackID`, `Name` (file stem), `Location`, `AverageBpm`, its markers, and its marks. Its `TrackID` is the first 8 hex digits of its `asset_id` read as an integer, increased by one until it collides with no library or output ID.
6. Write the XML and a receipt, `<output>.receipt.json`, listing each input track with its outcome: written or left out, grid copied, added, or omitted with reasons, and each cue request's outcome. Existing output files are replaced only with `--overwrite`.

`--cues` takes a JSON document mapping a local audio path to a list of cue requests. Sub-project 3 calls `build_rekordbox_import` with generated requests instead.

Writing cues into a track already in the user's collection requires a profile whose verified versions include the input XML's `PRODUCT Version`. Without one, the export fails with an `InputError` naming the probe, unless `--unverified-rekordbox` is given; the receipt then records that the version is unverified. New tracks are not gated.

## Compatibility probe

`scripts/rekordbox_probe.py` qualifies one Rekordbox version on the user's machine using only synthetic tracks, so no real track is modified. All files go in a probe folder the user chooses.

1. **`generate`** writes three 60 s click-track WAVs with accented downbeats (120 BPM constant; 120 BPM changing to 128 BPM at bar 17; 124 BPM after 2.3 s of silence), analyzes them through `build_rekordbox_import`, and writes `stage1.xml` and `CHECKLIST.md`. Stage 1 adds the three tracks as new tracks with their grids, hot cues in all slots A–H with distinct colours and names, twelve named memory cues with colours, and one loop.
2. The user imports `stage1.xml` with their normal analysis settings (Preferences → Advanced → Database → rekordbox xml; rekordbox xml pane → All Tracks → Import To Collection), adds one hot cue and one memory cue by hand to the first click track, and exports the collection.
3. **`stage2 --library <export>`** runs `build_rekordbox_import` on that export with `--unverified-rekordbox`, moving one SetVector hot cue, removing one, adding one, and renaming one memory cue. The user imports `stage2.xml` the same way, and imports it a second time, then exports the collection again.
4. **`check --stage1 <export> --stage2 <export>`** compares each export with `stage1.xml` and `stage2.xml` in the probe folder and prints, for each field, whether Rekordbox kept, rounded, replaced, merged, duplicated, or dropped it: grid markers, hot cue slots and colours, memory cue count, names and colours, loops, the user's manual cues, duplicate tracks for one location, and timing precision.

The findings become the 7.2.19 profile in `rekordbox/profile.py` and a table in `docs/rekordbox-compatibility.md` with the Rekordbox version, operating system, and analysis settings used. If the probe shows that full-state records lose or duplicate user data, the writer's approach is revised before any real track is written. Afterwards the user deletes the three click tracks from the collection.

## Errors

- Unreadable or malformed XML, a missing `COLLECTION`, a `TRACK` without `TrackID` or `Location`, or invalid numbers: `InputError` naming the file and track.
- A `--cues` path not in the library and not in `--add`, or an invalid request: `InputError`.
- An unverified Rekordbox version when writing cues into existing tracks: `InputError`, as above.
- Missing audio, a non-file location, or no reliable grid: not an error; the track is skipped or its grid omitted, with the reason in the receipt.
- Analysis failures propagate as they do from `analyze`.
- A written file that does not read back identical: `ArtifactError`; nothing is left at the output path.

## Testing

- **Reader:** synthetic fixtures in `tests/fixtures/rekordbox/` modelled on the 7.2.18 export (full attribute set, multi-line attributes, hot cues 0–7, memory cue without colour, streaming location, sampler track). Locations containing spaces, `%`, `#`, `&`, apostrophes, accented characters, and a drive root decode correctly. Malformed documents raise `InputError`.
- **Grid expansion:** Codex's cases — a single marker; several markers with bar-phase resets; a later marker a few milliseconds after a rounded predicted beat, which must not create a duplicate beat; markers before 0 and after the end.
- **Grid conversion:** a two-segment `beat_this` rhythm converts to markers whose expansion matches its beats within 5 ms; a 124.004 BPM segment over 400 s gains a marker so drift stays within 5 ms; fallback and `none` rhythms produce no markers; 3/4 bars produce `Metro="3/4"`.
- **Cue policy (table-driven):** free preferred slot; preferred slot held by a user cue (moved to the lowest free slot); slots held only by SetVector cues (replaced); all eight slots held by the user (`no_free_slot`); memory limit reached (`over_memory_limit`); user marks unchanged in every case; SetVector marks from a previous export removed.
- **Writer:** deterministic bytes; read–write–read equality, including passthrough attributes and unknown child elements; locale-independent numbers; the output playlist lists exactly the written tracks.
- **Application:** existing grids copied unchanged; a new track gets a grid only from a reliable `beat_this` rhythm; `--add` matches library tracks by path; `TrackID` collisions are avoided; the version gate blocks and `--unverified-rekordbox` allows cue writes into existing tracks; the receipt records every skip and omission. Tests use a stub rhythm through the existing analysis cache, not the model.
- **CLI:** `inspect` and `export` JSON output and error exit codes.
- **Offline:** the blocked-socket test covers `rekordbox export` on a synthetic track.
- **Manual:** the probe on Rekordbox 7.2.19.

Personal libraries and audio stay out of Git; fixtures are synthetic.

## Limitations

- Only Rekordbox's documented XML import is supported. The bridge cannot set Rekordbox's phrase analysis, waveforms, or My Tags, and cannot lock a grid against re-analysis.
- Until the probe runs, cue writing into existing tracks is gated, and re-import, D–H hot cues, memory cue colours, and grid persistence are unverified.
- A track is matched to the library by its file path. A moved or renamed file is treated as a new track; content-based matching is left for later.
- Grids written by SetVector use `Metro` `3/4` or `4/4` only, because Beat This! grids are accepted only with those bar lengths.
- Playlists in the user's export are ignored; the output contains one playlist of the written tracks.
- Rekordbox grids are used as given. The bridge does not judge their accuracy; the comparison snapshot shows they can disagree with SetVector on downbeats.
