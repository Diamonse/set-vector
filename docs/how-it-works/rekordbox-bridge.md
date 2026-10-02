# Rekordbox bridge

The Rekordbox bridge reads a Rekordbox XML collection export, matches its tracks to local audio files, and writes a second XML file that Rekordbox can import: SetVector's beat grid for tracks Rekordbox has not analyzed, and SetVector's cues on top of whatever the user already has. It never touches Rekordbox's own database, and it never replaces an existing grid or an existing (non-SetVector) cue. A companion script, `scripts/rekordbox_probe.py`, measures what a given Rekordbox version actually does with an imported file, because the bridge will not change a track already in the collection until that version has been measured.

This page covers the XML shapes involved, how a track is matched between the two sides, the grid-conversion math, how cues are placed, the comparison report used by the probe, and the safety rules. Beat and downbeat detection itself (the Beat This! model and its fallback) is covered in `rhythm-and-beat-grid.md`; where artifacts are cached on disk is covered in `data-and-storage.md`.

## Pipeline at a glance

1. **Read** the user's Rekordbox XML export into immutable `RekordboxTrack` records, one per `COLLECTION/TRACK`, keeping every attribute, `TEMPO` marker, and `POSITION_MARK` verbatim (`src/setvector/rekordbox/read.py` → `read_library`).
2. **Match** each track SetVector is asked to touch (`--add` or `--cues`) to a library record by decoded file path, or treat it as new if no record matches (`src/setvector/application/rekordbox.py` → `build_rekordbox_import`).
3. **Grid.** If the matched track already has `TEMPO` markers, copy them unchanged. If it has none, run the cached analysis pipeline and, when it produced a reliable Beat This! grid, convert that grid into Rekordbox `TEMPO` markers (`src/setvector/rekordbox/grid.py` → `tempo_markers_for`).
4. **Cues.** If the caller supplied cue requests for a track, replace only the `POSITION_MARK` entries SetVector itself owns (named `SV …`), leaving every user mark untouched, and place hot cues in free slots and memory cues up to a limit (`src/setvector/rekordbox/cues.py` → `place_cues`).
5. **Write** one `DJ_PLAYLISTS` document containing the full new state of every changed track plus one playlist listing them, and verify it reads back identically before anything touches disk (`src/setvector/rekordbox/write.py` → `render_library`).
6. **Receipt.** Record what happened to every track and cue request as JSON next to the XML, including any grid omitted or cue that could not be placed.
7. **Verify (manual).** `scripts/rekordbox_probe.py` builds synthetic tracks, has the user import them into real Rekordbox, and `compare_libraries` checks what came back out against what was written, to qualify a Rekordbox version before the bridge will touch tracks already in the collection.

Code: `src/setvector/application/rekordbox.py` → `build_rekordbox_import`; `src/setvector/cli/__init__.py` → `_run_rekordbox_export`.

---

## 1. Rekordbox XML as the code reads it

**What and why.** Rekordbox's File → Export Collection writes an XML projection of its database. SetVector treats this as the only interchange format — it reads this export for reference data and writes a file in the same shape for Rekordbox to import. It never reads or writes Rekordbox's own (undocumented, encrypted) `master.db`.

**Document shape.** A minimal real export, from the test fixture `tests/data/rekordbox-collection.xml` (modelled on a 7.2.18 export):

```xml
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="7.2.18" Company="AlphaTheta"/>
  <COLLECTION Entries="4">
    <TRACK TrackID="101" Name="Club Track" ... AverageBpm="124.00" ...
           Location="file://localhost/C:/Music/Tom%27s%20%26%20Jerry%20%231/Caf%C3%A9%20100%25.mp3"
           Tonality="8A" ...>
      <TEMPO Inizio="0.054" Bpm="124.00" Metro="4/4" Battito="1"/>
    </TRACK>
    <TRACK TrackID="102" Name="Two Tempos" ... Location="file://localhost/C:/Music/two%20tempos.mp3">
      <TEMPO Inizio="0.051" Bpm="123.00" Metro="4/4" Battito="3"/>
      <TEMPO Inizio="120.051" Bpm="126.00" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="" Type="0" Start="97.609" Num="1" Red="69" Green="172" Blue="219"/>
      <POSITION_MARK Name="" Type="0" Start="50.465" Num="-1"/>
      <POSITION_MARK Name="Loop" Type="4" Start="30.000" End="37.742" Num="-1"/>
      <POSITION_MARK Name="SV Drop" Type="0" Start="60.000" Num="7" Red="255" Green="0" Blue="0"/>
    </TRACK>
    ...
  </COLLECTION>
  <PLAYLISTS>...</PLAYLISTS>
</DJ_PLAYLISTS>
```

**`COLLECTION/TRACK`.** Each `TRACK` element has a `TrackID` (positive integer, unique within the document) and a `Location` URI, plus dozens of other attributes (`Name`, `Artist`, `Kind`, `Size`, `TotalTime`, `SampleRate`, `AverageBpm`, `Tonality`, `Comments`, …) that SetVector keeps verbatim without interpreting, in document order, in `RekordboxTrack.attributes`. Any child element that is not `TEMPO` or `POSITION_MARK` (SetVector has not observed any in practice, but the format allows them) is kept as serialized XML text in `extra_elements` so a rewritten track reproduces it exactly. `Location` is a `file://localhost/` URI with the path percent-encoded (`%20` for space, `%27` for apostrophe, `%26` for `&`, `%23` for `#`, non-ASCII letters encoded too, e.g. `Caf%C3%A9`); `path_from_location` decodes it to a `pathlib.Path` for a Windows drive path, and returns `None` for anything else, including a streaming location like `file://localhost/soundcloud:tracks:1044057805`.

Code: `src/setvector/rekordbox/model.py` → `RekordboxTrack`, `path_from_location`; `src/setvector/rekordbox/read.py` → `_track`.

**`TEMPO`.** One `TEMPO` element is one beat anchor:

| Attribute | Meaning | Format observed |
|---|---|---|
| `Inizio` | Anchor time in seconds | 3 decimals (milliseconds) |
| `Bpm` | Tempo from this anchor forward | 2 decimals |
| `Metro` | Time signature, numerator`/`denominator | `4/4` in every sample seen; SetVector only ever writes `3/4` or `4/4` |
| `Battito` | The anchor beat's position within the bar (1-based) | integer from 1 to the `Metro` numerator |

`TempoMarker` validates `Inizio` is nonnegative, `Bpm` is positive and finite, `Metro` matches `^\d+/\d+$`, and `Battito` is between 1 and the numerator. A track can carry one marker (a constant-tempo grid) or many (Rekordbox's own dynamic/tempo-change analysis can produce 276–748 markers on a single song, per the design spec's evidence from a real collection).

**`POSITION_MARK`.** One `POSITION_MARK` element is a cue or loop point:

| Attribute | Meaning |
|---|---|
| `Name` | Text label; empty string for an unnamed cue |
| `Type` | `0` cue, `1` fade-in, `2` fade-out, `3` load, `4` loop |
| `Start` | Start time in seconds, 3 decimals |
| `End` | End time in seconds, 3 decimals; present only for a loop |
| `Num` | `-1` for a memory cue, or `0`–`7` for hot cue slots A–H |
| `Red`/`Green`/`Blue` | Optional colour, all three present or all three absent |

`PositionMark.kind` is one of `cue`, `fade_in`, `fade_out`, `load`, `loop` (from `Type`); `slot` is `None` for `Num="-1"` or an int 0–7. `CueRequest` (what SetVector asks to place) only ever produces `cue` or `loop` — the other three kinds are read from existing tracks but SetVector never writes them.

Code: `src/setvector/rekordbox/model.py` → `TempoMarker`, `PositionMark`; `src/setvector/rekordbox/read.py` → `_tempo`, `_mark`.

**Reader safety.** `read_library` rejects any document declaring a `DOCTYPE` or an XML entity, in any encoding, with a pre-scan using `xml.parsers.expat` before the real parse — Rekordbox never writes either, so their presence means the file did not come from Rekordbox. A malformed document, a missing `COLLECTION`, or a `TRACK` missing `TrackID`/`Location` raises `InputError` naming the file and the offending track. Playlists are parsed into the data model but never read by SetVector; the output always contains exactly one playlist, listing the tracks SetVector wrote.

Code: `src/setvector/rekordbox/read.py` → `read_library`, `_reject_doctype_and_entities`.

---

## 2. Matching a SetVector track to a Rekordbox record

**What and why.** SetVector needs to know, for every file it is asked to add a grid or cues to, whether Rekordbox already has a record for that file (so it must preserve that record's existing grid and cues) or not (so it writes a brand-new `TRACK`).

**Matching key.** Every library track's `Location` is decoded to a `Path` and resolved; every `--add` path and every `--cues` key is resolved the same way (`os.path.normcase(str(Path(path).resolve()))`). Equal resolved, case-normalized paths are the same track. A track whose `Location` does not decode to a file path (a streaming track, or a location SetVector cannot resolve, e.g. an unreachable network drive or an embedded null byte) can never be matched by `--add` or `--cues`.

**Ambiguity.** If more than one `TRACK` record in the library resolves to the same file path, that file is ambiguous: if cue requests target it, the export fails outright (`InputError`, since there is no single record to write cues onto); otherwise it is silently skipped and recorded in the receipt as `"status": "skipped"`.

**New vs. existing.** A track is "new" purely relative to the XML export given on this run — not relative to the user's actual Rekordbox state. If the export is stale (taken before the track was added to Rekordbox, or is a playlist export missing it), SetVector will write it as a brand-new `TRACK`, and importing that record will overwrite whatever Rekordbox already has for that file. This is why the CLI always requires a full collection export and warns whenever any track is written as new.

Code: `src/setvector/application/rekordbox.py` → `_key`, `_select_tracks`, `build_rekordbox_import`.

---

## 3. Converting a SetVector beat grid into `TEMPO` markers

**What and why.** SetVector's rhythm analysis (see `rhythm-and-beat-grid.md`) produces a `RhythmAnalysis` with one or more `GridSegment`s — each a constant-tempo run of beats, `start_seconds + n · 60/bpm` for `n` in `0..beat_count`, with known bar positions. Rekordbox instead stores a grid as a sparse list of `TEMPO` anchors: Rekordbox itself (and SetVector's own `expand_tempo`, used to read a grid back) extrapolates beats forward from the nearest-preceding anchor at a constant interval until the next anchor. `tempo_markers_for` is the forward direction: turning a SetVector grid into the minimal set of anchors that reproduce it once re-expanded.

**Precondition.** Only a *reliable* `beat_this`-sourced rhythm converts; a fallback or absent grid has no bar positions to anchor `Battito` to, so `tempo_markers_for` raises `ValueError` for anything else. Every bar position in the rhythm must also be within the meter (`1..bar_length`); `modal_bar_length` (from the rhythm's quality measurement) must be known.

**Inputs → outputs.** `RhythmAnalysis` (with `grid_segments`, `bar_positions`, and `quality["beat_this"].modal_bar_length`) → `tuple[TempoMarker, ...]`.

### 3.1 One marker per constant run

For each `GridSegment`, `Metro` is `f"{bar_length}/4"` (SetVector only ever emits `3/4` or `4/4`, because those are the only bar lengths a Beat This! grid is accepted with). The segment's `Bpm` is `round(segment.bpm, 2)` and its nominal period is

```math
\text{period} = \frac{60}{\text{round}(\text{bpm}, 2)}
```

Rekordbox only stores `Inizio` to the millisecond and `Bpm` to two decimals, so re-expanding a single anchor at the rounded BPM will drift from SetVector's exact beat times as the run gets longer. Starting at the segment's first beat, the algorithm extends the current anchor through as many following beats as keep matching:

```math
\lvert \text{start} + \text{step}\cdot\text{period} - t_{\text{anchor}+\text{step}} \rvert \le \text{DRIFT\_TOLERANCE\_SECONDS} = 0.005\ \text{s}
```

and whose bar position is exactly what modular counting from the anchor predicts:

```math
\text{expected\_position} = \bigl((\text{position}_{\text{anchor}} - 1 + \text{step}) \bmod \text{bar\_length}\bigr) + 1
```

The moment either check fails, a new `TempoMarker` is started at that beat (its own exact time, rounded to milliseconds: `round(t, 3)`, and its own `Bpm`, rounded independently). This naturally emits exactly one marker per segment if the rounded BPM tracks it closely enough for its whole length, and more than one when rounding drift would otherwise accumulate past 5 ms, or when the bar phase jumps (e.g. an odd bar was inserted).

**Worked example — no drift.** A two-segment rhythm, `GridSegment(0.5, 120.0, 8, 1)` then `GridSegment(4.5, 128.0, 8, 1)` (120 BPM for 8 beats starting at 0.5 s, then 128 BPM for 8 beats starting at 4.5 s), converts to exactly two markers:

```
TempoMarker(0.5, 120.0, "4/4", 1)
TempoMarker(4.5, 128.0, "4/4", 1)
```

**Worked example — rounding drift forces extra markers.** A single 800-beat segment at 124.004 BPM starting at 0.2504 s (`GridSegment(0.2504, 124.004, 800, 1)`) rounds to `Bpm=124.00`, period `60/124 ≈ 0.483871 s`, versus the true period `60/124.004 ≈ 0.483855 s` — a difference of about 15 µs per beat. That accumulates past the 5 ms tolerance at beat 346 (predicted `167.669 s` vs. actual `167.664 s`, drift ≈ 5.0004 ms), so `tempo_markers_for` emits three markers:

```
TempoMarker(0.250,   124.0, "4/4", 1)
TempoMarker(167.664, 124.0, "4/4", 3)
TempoMarker(334.111, 124.0, "4/4", 3)
```

(All three still round to the same `Bpm`; only `Inizio` and `Battito` change — each new anchor restarts the drift budget from zero at its own exact position.)

Code: `src/setvector/rekordbox/grid.py` → `tempo_markers_for`.

### 3.2 Segment boundaries and the bridging marker

**What and why.** SetVector's grid engine can leave a gap of up to 1.5× the local beat period between one segment's last beat and the next segment's first beat (e.g. where no reliable beat was detected). If the last segment's anchor were simply left running at its own BPM, extrapolating it forward (the way `expand_tempo` and Rekordbox itself would) could predict a spurious extra beat inside that gap, before the next segment's own anchor takes over.

`_bridge_segment_gap` checks, after finishing a segment, whether the last anchor's own extrapolation would land a predicted beat too close to the next segment's first marker:

```math
\text{predicted\_next} = \text{last\_marker.start} + \text{run\_length} \cdot \text{period}_{\text{last}}
```

```math
\text{guard} = \min(0.120,\ \tfrac{1}{4}\,\text{period}_{\text{last}},\ \tfrac{1}{4}\,\text{period}_{\text{next}})
```

If `predicted_next < next_start − guard`, a bridging marker is needed: it retimes the segment's actual last beat into a marker whose own (temporary) BPM is tuned so that its single-beat extrapolation lands exactly on the next segment's start:

```math
\text{bridge\_bpm} = \text{round}\!\left(\frac{60}{\text{next\_start} - \text{last\_beat}},\ 2\right)
```

If the run this bridge covers is only one beat long, it *replaces* the segment's sole marker; otherwise it is *appended* after the marker covering the rest of the segment. Either way, `expand_tempo` reading the result back will see the bridge marker and the next segment's marker close enough together (within the same quarter-period guard) that the bridge contributes no extra beat of its own — the next segment's anchor simply takes over.

**Worked example.** `GridSegment(0.5, 120.0, 8, 1)` (beats at 0.5, 1.0, …, 4.0) followed by `GridSegment(4.7, 128.0, 8, 1)` (next segment starts 0.7 s after the first segment's last beat at 4.0 s, not the nominal next beat at 4.5 s) converts to three markers:

```
TempoMarker(0.5, 120.00, "4/4", 1)   # covers beats 0–6 of segment 1
TempoMarker(4.0, 85.71,  "4/4", 4)   # the bridge: retimes beat 7 (the segment's last beat)
TempoMarker(4.7, 128.00, "4/4", 1)   # segment 2's own anchor
```

`85.71 = round(60 / (4.7 − 4.0), 2)`. Read back through `expand_tempo`, the bridge's own single-beat extrapolation would land at `4.0 + 60/85.71 ≈ 4.7` — inside the next marker's guard — so it contributes no beat, and the grid reads back as exactly the original 16 beats with no phantom beat in the 0.7 s gap.

Code: `src/setvector/rekordbox/grid.py` → `tempo_markers_for`, `_bridge_segment_gap`.

### 3.3 Reading a Rekordbox grid back: `expand_tempo`

**What and why.** The inverse direction — turning a list of `TempoMarker`s into beat times and bar positions — is needed both to verify `tempo_markers_for`'s own round trip and, per the design spec, for future phrase detection reading an existing Rekordbox grid.

**Rule.** Markers are sorted by `start_seconds` (a malformed or out-of-order export is tolerated). For each marker in order, beats are generated at `start + step · (60/bpm)` until either the given `duration_seconds` or the next marker's start (minus a guard), whichever is sooner; `beat_in_bar` advances as `((anchor_position − 1 + step) mod beats_per_bar) + 1`. Nothing is extrapolated before the very first marker — there is no "beat zero" implied before the first anchor.

**The rounding guard.** Because Rekordbox (and SetVector) only stores `Inizio` to the millisecond, two adjacent markers can be a few milliseconds apart without a full beat between them (one is effectively a correction of the other, not a new beat). A beat predicted within a guard of the next marker's start is dropped — the later marker's own first beat wins instead:

```math
\text{guard} = \min(0.120,\ \tfrac14\,\text{period}_{\text{this}},\ \tfrac14\,\text{period}_{\text{next}})\ \text{seconds}
```

If a marker's own start is already within its successor's guard, it contributes **no** beats at all (it is entirely swallowed by the next marker). Two generated beats closer than 1 ms are also collapsed to one (keeping the later one's time and position), which is how the single-beat "bridge" marker above disappears on read-back. A marker predicting more than `MAX_BEATS_PER_MARKER = 200,000` beats raises `ValueError` — a guard against a pathological marker (e.g. a near-zero BPM) silently hanging the expansion.

Code: `src/setvector/rekordbox/grid.py` → `expand_tempo`.

---

## 4. Converting cues

**What and why.** SetVector expresses a cue it wants to add as a `CueRequest` (a label, a start time, hot-or-memory, optionally a loop end, a preferred hot-cue slot, and a colour); `place_cues` turns a track's existing marks plus a list of requests into the final list of `PositionMark`s to write, obeying the "never touch the user's own cues" rule.

**Ownership.** A mark is SetVector's own if and only if its `Name` starts with the literal prefix `"SV "` (`SETVECTOR_PREFIX`). `CueRequest.label` is rejected outright if the caller already supplies that prefix — it is added once, by the writer, so a caller cannot forge ownership of an arbitrary existing mark. Exporting cues for a track replaces *all* of that track's `SV `-prefixed marks with the new request list (even if a request list is empty, meaning "remove every SetVector cue"); every non-`SV ` mark is carried through completely unchanged, in both content and position in the returned tuple's ordering relative to other user marks.

**Hot cues (`Num` 0–7, slots A–H).** A request's `preferred_slot` is honoured if free; "free" means not held by any *user* mark — a slot currently occupied only by a previous SetVector mark counts as free, since that mark is about to be replaced anyway. If the preferred slot is taken by a user cue, the request falls back to the lowest-numbered free slot and is reported `moved_slot`. If every slot (there are `HOT_CUE_SLOTS = 8` of them, but a measured `CapabilityProfile.hot_cue_slots` can be fewer) is held by the user, the request is reported `no_free_slot` and nothing is written for it. Requests without a `preferred_slot` simply take the lowest free slot, in request order.

**Memory cues (`Num="-1"`).** Each placed memory cue counts against `CapabilityProfile.memory_cue_limit` (default, unverified: 10); once the running count (existing user memory cues plus memory cues already placed this run) reaches the limit, further requests are reported `over_memory_limit` and dropped.

**Colour.** A hot cue's colour is always kept. A memory cue's colour is kept only if the profile says memory cue colours import (`memory_cue_colours is not False`) — under the default unverified profile (`None`, meaning "unknown"), colour is kept optimistically; a profile that has measured colours do *not* survive import sets `memory_cue_colours = False` and the bridge drops the colour rather than writing something Rekordbox will silently ignore or mishandle.

**Rounding.** Every written `start_seconds`/`end_seconds` is rounded to milliseconds (`round(x, 3)`) — the precision Rekordbox's own `Start`/`End` attributes use — so re-running an export against its own output is idempotent (`test_repeating_an_export_gives_the_same_marks`). A loop's `end_seconds` must already be at least 1 ms after its rounded `start_seconds`, checked before rounding is even applied.

**Loops and other kinds.** A `CueRequest` is only ever `kind="cue"` or `kind="loop"` (`Type` 0 or 4); `fade_in`, `fade_out`, and `load` marks (`Type` 1, 2, 3) only ever arrive by being read from an existing track and are carried through unchanged — SetVector never originates them.

Code: `src/setvector/rekordbox/cues.py` → `place_cues`, `CueRequest`.

---

## 5. Writing the XML

**What and why.** `render_library` builds one `DJ_PLAYLISTS` document from scratch with `xml.etree.ElementTree` (never string concatenation, to avoid any escaping mistake), containing only the tracks SetVector actually changed, plus one playlist (default name `"SetVector"`) listing them by `TrackID`.

**Numbers.** `format_decimal(value, places)` formats without locale, using `places` decimals (3 for `Inizio`/`Start`/`End`, 2 for `Bpm`/`AverageBpm`) unless more digits are needed so the text parses back to the exact same float — i.e. it never silently loses precision beyond what's needed to round-trip. `-0.0` normalizes to `0.0` first.

**Self-check.** Before anything is returned, `render_library` parses its own output back through `parse_library` and compares the resulting tracks for exact equality with what was asked to be written; any mismatch raises `ArtifactError` ("rendered Rekordbox XML does not read back identically") rather than risk writing a file that looks right but imports wrong.

**New-track attributes.** A brand-new `TRACK` record needs `Name` (the file's stem), and — the load-bearing detail discovered on Rekordbox 7.2.19 — `Kind`, `Size`, and `TotalTime`, or Rekordbox accepts the import but silently drops the `TEMPO` and `POSITION_MARK` data from it. `SampleRate` is added alongside them (not strictly required, but every real Rekordbox export always has it) and `AverageBpm` when a grid was written. `TrackID` for a new track is derived from the first 8 hex digits of the analyzed audio's content-addressed `asset_id`, interpreted as an integer and masked to 31 bits (`& 0x7FFFFFFF`, a zero result forced to `1`), then incremented modulo that same mask until it collides with no ID already used in the library or already assigned in this run.

**Existing-track `Location`.** An existing track's raw `Location` string is kept byte-for-byte (not re-encoded from its decoded path), because Rekordbox may match tracks by that exact string. Only a brand-new track's path is freshly encoded (`file://localhost/` + `urllib.parse.quote` of the forward-slash path, keeping the drive letter and colon unescaped).

Code: `src/setvector/rekordbox/write.py` → `render_library`, `format_decimal`; `src/setvector/application/rekordbox.py` → `_new_track`.

---

## 6. The comparison report

**What and why.** `compare_libraries` is how both the manual probe and (potentially) a user verify that what Rekordbox actually stored after an import matches what SetVector wrote. It is not a live diff against Rekordbox's database — it compares two XML documents SetVector reads: the file SetVector wrote (`expected`) and a fresh export taken from Rekordbox after importing it (`actual`).

**Track matching.** Tracks are paired by decoded file path (`_location_key`, case-normalized). A track present in `expected` but absent from `actual` is `missing`; more than one `actual` record at the same path is `duplicated`.

**Tempo marker matching.** Markers are **not** compared by list position — inserting or deleting one marker must not cascade into every later marker looking "changed." Instead each expected marker is paired with the nearest-start unconsumed actual marker within `TEMPO_MATCH_SECONDS = 0.5` s (`_pair_nearest`, greedy nearest-match in expected order, each actual marker consumed at most once). A pair is:

- `missing` — no actual candidate within 0.5 s.
- `changed` — paired, but `(Metro, Battito)` differ, or `|Δbpm| > BPM_TOLERANCE = 0.005`.
- `kept` — paired, same grid, and `|Δstart| ≤ EXACT_SECONDS = 0.0005` s (0.5 ms).
- `rounded` — paired, same grid, and `0.0005 < |Δstart| ≤ ROUNDED_SECONDS = 0.005` s (5 ms) — i.e. consistent with Rekordbox's own millisecond rounding, not a real change.
- otherwise `changed` (start moved by more than 5 ms).

Any actual marker left unconsumed is reported `extra` at its own time and BPM.

**Mark (cue) matching.** A mark's identity is its hot-cue slot (`("hot", slot)`) if it has one, otherwise its `(kind, name)` — two memory cues with the same name and kind are considered the same mark. A hot cue's slot, or a *named* memory mark, is unambiguous, so matching is unbounded in time; an *unnamed* memory mark could collide with many unrelated marks sharing the same empty name, so its match is bounded to `UNNAMED_MATCH_SECONDS = 1.0` s. Within its identity group, pairing again takes the nearest unconsumed start time. A matched pair's status reuses the same `kept`/`rounded`/`changed` timing buckets as tempo markers (`EXACT_SECONDS`/`ROUNDED_SECONDS`), plus `changed` if the name, kind, colour, or loop end differ. An unmatched actual mark sharing an expected mark's identity, close enough (within `ROUNDED_SECONDS`, or always for a hot cue, since its slot alone is already definitive) is reported `duplicated`; anything else left over is `extra`.

**What this measures in practice.** The probe uses it to answer, per Rekordbox version: whether re-importing a track already in the collection replaces, merges, or ignores its grid and cues; whether hot cue slots D–H and memory cue colours survive import at all; whether an imported grid survives Rekordbox's own auto-analysis; and how closely Rekordbox preserves marker/mark timing (kept exactly, rounded, or genuinely changed).

Code: `src/setvector/rekordbox/compare.py` → `compare_libraries`, `compare_track`, `_pair_nearest`.

---

## 7. Safety rules

These rules are enforced in code, not just documented intent:

- **Never replace an existing grid.** `_process` (in `application/rekordbox.py`) only calls the analyzer and `tempo_markers_for` when `track.tempo` is empty; if the track already has any `TEMPO` marker, it is copied through completely unchanged, however many markers it has.
- **Never touch a user's own cue.** `place_cues` partitions a track's marks into `user` (anything not named with the `"SV "` prefix) and SetVector's own on entry; only the SetVector subset is ever replaced, and the `user` list passes straight through to the result untouched, including which hot-cue slots they occupy.
- **Version gate for existing tracks.** Writing a grid or cues into a track *already in the library* requires `profile_for(library.product_version).verified` (i.e. the version has a measured `CapabilityProfile` in `profile.py`, filled in only from real probe results) or an explicit `--unverified-rekordbox` / `allow_unverified=True` override. New tracks are never gated, since there is nothing existing to damage. Until a version is qualified, `PROFILES` is empty and every version falls back to `UNVERIFIED = CapabilityProfile((), 8, 10, None, None, None)`.
- **Full-state writes, not deltas.** Every track SetVector touches is written with its *complete* desired state — every existing attribute, every kept `TEMPO` marker, every user and SetVector mark — not just the new additions. This is deliberate: whether a given Rekordbox version replaces or merges a re-imported record, writing the full state is correct either way (see the design spec's "Approach" section); writing only the additions would be correct under merge but would silently delete the user's existing cues under replace.
- **Output cannot clobber an input.** The output XML and its receipt path are checked against the library file, every `--add`ed file, and every library track named by `--add`/`--cues`; writing to any of them raises `InputError` before anything is touched.
- **Atomic, verified write.** The XML is written only after `render_library`'s self-check (section 5) passes; the receipt is written only after the XML; if the receipt write fails, the XML is deleted so the two files are never left mismatched or one without the other.
- **Everything is logged, not silently dropped.** Every decision — a grid omitted (and why), a cue not placed (`no_free_slot`, `over_memory_limit`), a cue moved to a different slot, an ambiguous duplicate track skipped, a track written as "new" that might already exist in Rekordbox under a different export — is recorded in the JSON receipt (`<output>.receipt.json`) and surfaced as a CLI warning on stderr.

Code: `src/setvector/application/rekordbox.py` → `build_rekordbox_import`, `_process`, `_guard_output_targets`.

---

## 8. The manual probe and verification workflow

**Why a manual probe at all.** Rekordbox's XML import behaviour for re-imported tracks, hot cue slots beyond the common ones, memory cue colours, and whether an imported grid survives Rekordbox's own auto-analysis are all undocumented. Nothing in the bridge writes into a track *already in the collection* until a human has run this probe against their actual Rekordbox installation and the measured behaviour has been encoded as a `CapabilityProfile`.

**What it builds.** `scripts/rekordbox_probe.py generate <folder>` synthesizes three WAV drum tracks entirely with NumPy (kick on every beat, snare on 2 and 4, off-beat hats, a bass note per bar, a crash every 4th bar) — no real audio is ever touched:

| Track | Grid | Purpose |
|---|---|---|
| `probe-1-constant-120.wav` | 120 BPM, 44 bars | Hot cues A–F + 12 named memory cues + 1 loop |
| `probe-2-tempo-change.wav` | 120→128 BPM at bar 23 | Hot cues A–H (all 8 slots) |
| `probe-3-late-start.wav` | 124 BPM, starts 2.3 s in | 1 hot cue + 2 memory cues |

It runs these through the real `build_rekordbox_import` pipeline (with `library_path=None`, since no Rekordbox export of them exists yet) and writes `stage1.xml` plus a `CHECKLIST.md` of manual steps.

**The manual loop.**

1. The user imports `stage1.xml` into real Rekordbox (with automatic analysis and CUE Analysis switched off in Preferences, per the checklist — otherwise Rekordbox overwrites the imported grid/cues with its own), adds one hot cue and one memory cue by hand to track 1 only, and exports the collection (`export-1.xml`).
2. `stage2 <folder> --library export-1.xml` builds `stage2.xml` from that export, which moves one SetVector hot cue, removes one, adds one, and renames one memory cue (exercising `place_cues`'s slot/limit logic against a real re-import). The user imports it (twice, to test re-import specifically) and exports again (`export-2.xml`).
3. `check <folder> --export1 export-1.xml --export2 export-2.xml` runs `compare_libraries` between what was written and what Rekordbox actually exported back, prints every finding, and writes `probe-results.json`.

**What gets filled in afterward.** The findings turn into a new entry in `PROFILES` (`profile.py`) and a row in `docs/rekordbox-compatibility.md`, naming the Rekordbox version, OS, and the Preferences → Analysis settings used — this is what lifts the version gate in section 7 for that specific Rekordbox version.

Code: `scripts/rekordbox_probe.py` → `generate`, `stage2`, `check`; `src/setvector/rekordbox/profile.py` → `CapabilityProfile`, `PROFILES`.

---

## Limitations and open questions

As of this writing, `PROFILES` is **empty** — no Rekordbox version has actually been qualified by running the probe end to end. Everything below is unverified against real Rekordbox behaviour, per `docs/rekordbox-compatibility.md`:

- **Re-import behaviour** (replace / merge / ignore a track already in the collection) — stage 2 of the probe measures this but has not been run to completion.
- **Hot cue slots D–H and memory cue colours** surviving import — only slots and colours written to a *new* track have been observed (they appear correctly in that case); the existing-track path is unmeasured.
- **Whether an imported grid survives Rekordbox's own auto-analysis** when settings are left on their defaults rather than switched off as the checklist instructs.
- **The single-beat bridging marker** (section 3.2) has not been checked against a real Rekordbox import — the probe's own synthetic tempo change (bar 23) has no gap wide enough to exercise it.
- **`TrackID` up to 2³¹−1** — whether Rekordbox accepts an ID in the upper end of that range for an imported new track is unmeasured.
- **The `"SV "` name prefix is the only ownership marker.** A user-created cue whose name happens to already start with `"SV "` is indistinguishable from SetVector's own and will be silently replaced on the next export that touches that track. There is no escaping or namespacing beyond the literal prefix check.
- **A track is matched only by file path.** A renamed or moved file looks like a brand-new track to the bridge; there is no content-based (e.g. audio fingerprint) matching.
- **Stale export risk is procedural, not enforced.** The bridge cannot detect that an export is stale relative to Rekordbox's live state — it can only warn when a track ends up written as "new" because it is missing from the given export (section 2).
- **A literal line break inside an XML attribute** (e.g. a multi-line `Comments` field) is already collapsed to spaces by XML attribute-value normalization before SetVector ever sees it; this is standard XML behaviour, not something the bridge does, but it means a round-tripped `Comments` field will never regain its original line breaks.
- One line of a code comment in `application/rekordbox.py`'s `_process` function (explaining why marks are compared as a multiset rather than by order) is duplicated verbatim — harmless, but worth a cleanup pass.
