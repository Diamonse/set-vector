# SetVector to rekordbox export design

## Is the requested transfer possible, and what actually transfers?

### Takeaway

Yes: a local audio collection plus a rekordbox XML document is a credible supported exchange route. Promise an ordered playlist and validated DJ preparation metadata; do not promise that all SetVector analysis becomes native rekordbox analysis or that XML alone contains playable songs.

### Cited Findings

- The official XML specification provides `COLLECTION/TRACK`, mandatory file `Location`, integer `TrackID`, `AverageBpm`, `Tonality`, `Comments`, rating, and track color. `TEMPO` carries source start seconds (`Inizio`), BPM, meter (`Metro`), and beat within bar (`Battito`). `POSITION_MARK` carries name, type, start/end seconds, and slot; cue is type 0, loop type 4, memory slot -1, and the old specification names hot slots A–C as 0–2. Playlist nodes reference collection tracks by ID or location. UTF-8 strings require XML escaping; media locations use URI form under `file://localhost/`. The schema has no arbitrary feature arrays, SetVector confidence records, transition schedules, or energy curves. Some units in the sheet are evidently mislabeled, including BPM described as seconds; this is a format reference, not a complete conformance specification. — [Official XML format](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf)
- The current 7.214 manual retains XML browsing/import: enable rekordbox XML in View → Layout, choose Imported Library in Advanced → Database, then import tracks into Collection or drag XML playlists into Playlists (pp. 19,45). Reanalysis can overwrite grids; Analysis Lock skips analysis and grid edits (pp. 91–92). Auto Analysis and CUE settings matter (p. 14). The manual documents ten memory cues and hot cues A–H; equipment support varies (pp. 95,112). XML exports can include beatgrids (p. 239). These facts establish a supported workflow, not the exact overwrite behavior of every XML attribute. — [rekordbox 7.214 manual](https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf)
- The developer page documents XML playlist exchange and prohibits same-name sibling playlists/folders; its older Bridge menu wording should not be used as the current import instructions. — [Official developer page](https://rekordbox.com/en/support/developer/)
- The official FAQ says CUE Analysis uses phrase analysis and its overwrite setting can replace cues. It also documents collection XML export, enabling a verification loop. — [rekordbox 7 FAQ](https://rekordbox.com/en/support/faq/rekordbox7/#faq-70993), [collection export](https://rekordbox.com/en/support/faq/rekordbox7/#faq-84655)
- SetVector currently computes RMS, spectral centroid, bass ratio, onset strength, tempo, and beat positions. It does not implement a key, meter, downbeat, cue, playlist, or rekordbox exporter in the audited code. The README describes several of these as goals. — [Baseline implementation](../../src/setvector/analysis/baseline.py), [bundle contracts](../../src/setvector/domain/bundle.py), [README](../../README.md)
- The project intends DJ preparation with reviewed transitions and no rendered mix. It explicitly distinguishes playlist occurrences, timed placements, and recorded mixes. — [Implementation plan](../../docs/implementation-plan.md), [architecture](../../docs/architecture.md#transition-and-set-extensions)

### Inferences

Recommended product language: “Export a rekordbox playlist with selected cues and supported metadata.” The deliverable is XML plus references to the same local audio files; optional audio packaging copies files byte-for-byte. A playlist generator selects/orders existing songs; it does not generate new audio. If the user means rendered edits/remixes, treat those as new audio assets and analyze them separately.

Use three output layers:

| Output layer | Recommended treatment |
|---|---|
| Rekordbox-facing metadata | Approved global key/BPM, reviewed point cues and deliberate loops, qualified grids, playlist order, ordinary descriptive tags. Only claim tested fields in the compatibility profile. |
| SetVector information for a DJ | Optional concise cue names/comments, e.g. an entry/exit label and short SetVector export reference. Preserve original comments unless an explicit composition policy applies. |
| Full SetVector result | Sidecar JSON/report with feature IDs, annotation revision, confidence, alternatives, energy curves, cue regions, predicted transitions, occurrence timing, calibration/model IDs, omissions, and chosen mappings. |

Do not map experimental energy automatically into rating: rating is a user preference field, and SetVector's planned 1–5 energy judgment names its own scale. Do not claim native phrase, waveform, vocal, stem, gain automation, or MIX POINT LINK import through this adapter. The researched XML format gives no contract for those outputs.

Use a pure supported XML adapter first. Editing rekordbox's internal database would couple core workflows to undocumented storage and migration behavior without being necessary to demonstrate the user's desired workflow. A public interchange artifact is reviewable, can be regenerated, and lets the user use rekordbox's own import UI.

### Gaps

- No live rekordbox import was run in this research. Current-version preservation of comments, cue labels/colors, loops, eight hot slots, tempo changes, and repeated playlist occurrences must be measured.
- Exact reimport identity and merge/replace rules are not established by the official specification. A stable XML `TrackID` is not proof that rekordbox will merge with the intended internal track.
- Audio codecs, target rekordbox versions, target DJ hardware, and whether songs should remain in place or be copied are release-scope choices. This research recommends local files and XML as the first boundary.

## Which contracts must be implemented before reliable export?

### Takeaway

Add export as a deterministic projection of explicitly selected reviewed artifacts. The largest model gap is that a reviewed entry/exit region does not specify a hot-cue trigger, while beat estimates and isolated downbeat anchors do not specify a complete beatgrid.

### Cited Findings

- The reviewed-annotation plan uses immutable full snapshots pinned to one asset and feature, explicit revision selection, cue intervals with optional beat anchors, and confirmed/uncertain/rejected status. Downbeat anchors explicitly do not imply meter. It allows exact EOF points but requires positive-width cue regions. — [Reviewed annotation plan](../../docs/superpowers/plans/2026-09-23-reviewed-annotations.md)
- Source seconds are the common coordinate. Feature timestamps are frame centers, with separate support boundaries; beat positions currently reference those timestamps. — [Architecture timing contract](../../docs/architecture.md#core-data-contracts), [feature series](../../src/setvector/domain/features.py), [baseline timing](../../src/setvector/analysis/baseline.py)
- Asset identity hashes complete file bytes, observed path is an absolute location, and decoding checks that content still matches the inspected asset. Retagging/reencoding changes identity. — [Audio ingestion](../../src/setvector/ingestion/audio.py), [AudioAsset](../../src/setvector/domain/audio.py)

### Inferences

Recommended domain additions, separately versioned from the existing baseline:

| Contract | Essential contents and purpose |
|---|---|
| `ExportSnapshot` | Schema/exporter version, target compatibility profile, ordered plan reference, pinned asset/feature/review IDs, approved metadata choices, timing transform profile, audio location manifest, generated XML hash, sidecar hash, explicit omitted fields and reasons. Immutable; no automatic “latest review.” |
| `ExportCueSelection` | Source annotation record ID, selected source trigger seconds, point versus loop, loop end only when explicitly selected, destination memory/hot, slot, label, review state. User selection or a named reviewed policy determines the trigger. |
| `ReviewedGrid` | Source-relative segments, BPM, meter, beat-within-bar at each anchor, phase/continuity validation, provenance, coverage and review status. Require enough information to express a meaningful grid. |
| `ExportLocation` | Asset ID, exact output file path/URI, original location, optional copied destination and verified digest. Paths are deployment details and do not replace content identity. |
| `TrackOccurrence` | Occurrence ID separate from asset ID, ordered index, selected cue references, and optional timed-plan reference. Repeated use remains represented even if the target profile cannot represent every contextual cue choice. |

Do not silently turn an entry region `[16,32)` into a loop or choose its end as an exit trigger. A cue region denotes an area considered usable; a DJ hot cue denotes a precise jump target. Selecting 16 seconds, a reviewed beat anchor, or another explicit point is a separate action. Preserve the source region in the sidecar. Similarly, do not emit a made-up 4/4 meter or extend a global BPM across a variable-tempo song unless a validated grid policy permits it. The first exporter can ship cues and playlist order while omitting grids.

Provenance precedence should be explicit: selected confirmed human revision → qualified algorithm output only when an enabled policy allows it → omit unsupported/unknown data. A reviewed unknown key must suppress an older automatic guess. Retain all evidence in SetVector; the projection should report which facts were chosen and why. A global major/minor key can be mapped after spelling tests; local modulations need the sidecar or a human-readable marker, because one global key cannot faithfully encode them.

Time conversion rules:

1. Export source audio seconds, never set elapsed time or ordinal position. Use the saved seconds directly rather than recomputing `frame_index × hop / rate`; current feature centers make that recomputation wrong.
2. If the planner uses constant playback rate `r`, a placement maps source time `s` to set time `T + (s - source_in)/r`. Export `s`. If a UI stores set time, invert that mapping explicitly; require a monotone invertible map for variable rate.
3. A file decoded at a different analysis sample rate still uses source seconds. Do not scale seconds again by the rate ratio. Keep any decoder alignment offset separate from tempo/rate transforms.
4. Do not bake in a universal MP3 timing offset. Qualify each codec/decoder route using impulse/click fixtures in actual rekordbox. Preserve both canonical source times and the target-specific transform profile if empirical correction proves necessary.
5. Preserve fractional precision with locale-independent serialization; require finite nonnegative values. Enforce source duration bounds and target-profile limits. Exact EOF is valid in SetVector's annotation model but may be unusable as a trigger: report that projection error rather than silently moving it.

Path and serialization rules:

- Resolve a selected local location; verify it exists and matches the pinned asset before publishing a playable export. A report may work with missing audio, while a DJ export cannot promise playability without it.
- Use a URI encoder for path components, UTF-8 percent encoding for spaces/non-ASCII/reserved characters, forward slashes, and the documented local-file authority. XML-escape the resulting URI as an attribute using a standard XML writer; never manually concatenate XML. Test `%`, `#`, `&`, apostrophes, accented characters and Windows drive roots. Treat UNC/network paths as unqualified until explicitly supported.
- Preserve actual path case and filesystem Unicode semantics; do not normalize a real path merely to make a stable hash. Portable copies must handle basename collisions and destination case-insensitivity. Re-resolve paths and regenerate XML on another OS rather than assuming Windows and macOS share roots.
- Keep integer XML IDs separate from SHA-256 asset IDs. Maintain a collision-checked mapping per export lineage; identical snapshots reproduce IDs. Playlist entries use that mapping. Do not cast a truncated hash to an integer without collision handling.
- Collapse byte-identical assets to one chosen collection location by an explicit policy, retain each occurrence in the plan, and never dedupe using title/artist alone. Persist any deliberate distinct-copy decision. Do not create fake track IDs to force contextual cues onto the same media path.
- Names must be unique among sibling folders/playlists, deterministically disambiguated with a short plan ID if needed. Counts and references must agree. Publication should write XML, manifest and reports in a temporary bundle, validate them, then atomically publish the completed directory.

### Gaps

- This is a proposed export contract, not an implemented SetVector API.
- Cue region selection UX, maximum export cue policy, optional copy layout, and grid review protocol need explicit product decisions. The adapter should surface these choices without changing the already-planned annotation snapshot meaning.
- A single physical track may have different entry/exit choices in two sets. The export must detect slot conflicts across occurrences and request an explicit merged selection or keep alternative plans in separate export snapshots. Actual per-playlist cue isolation is not established.

## What implementation order and validation gates reduce rework?

### Takeaway

Run a tiny compatibility experiment before building a polished desktop workflow, then build reliable annotation/time contracts, a pure exporter, and a reviewed playlist flow. Automatic cues and full grids should follow evidence that their estimates and destination behavior are reliable.

### Cited Findings

- The current roadmap already places reviewed annotations before cue-aware transitions and timed plans. Its collection workflow is designed to work from saved artifacts without source files; the export preflight must add file availability checks for playback. — [Implementation plan](../../docs/implementation-plan.md), [reviewed annotation plan](../../docs/superpowers/plans/2026-09-23-reviewed-annotations.md)
- The architecture makes inference layers depend on shared contracts and separates raw measurements from corrections and derived results. — [Architecture](../../docs/architecture.md)

### Inferences

Recommended order, with a stopping condition for each stage:

1. **Compatibility experiment now.** Use a few generated click/impulse tracks, a minimal XML, and a disposable clean rekordbox library on Windows and macOS. Include Unicode paths, cue at zero, several point cues, an explicit loop, a constant grid, a tempo change, a global key and a short playlist. First establish that the exchange path behaves as expected; no desktop UI or automatic music analysis is needed. Record exact application/OS versions and settings. This prevents designing the rest of the product around unverified import behavior.
2. **Reviewed source contracts.** Complete the planned decoded-duration and immutable annotation work. Add explicit export cue selections as a distinct projection input. Test hash binding, invalid times, unknown-vs-absent semantics and preservation of raw artifacts. This gives downstream exports stable truth to reference.
3. **Pure XML serializer plus preflight.** Implement a data-only adapter behind application services and a CLI command. Build an `ExportSnapshot`, validate it, render XML/sidecar, reload both and verify counts/IDs/paths. Return a structured export report. Test malformed and reserved text, unsupported values, missing/mismatched files, collisions, duplicate occurrences, limits and deterministic output. A simple ordered list of reviewed tracks is sufficient; a search optimizer is not a prerequisite.
4. **Playlist and desktop integration.** Feed the same service with selected tracks and reviewed cues from the planner/editor. Display an export preview with track order, selected markers and skipped fields. Let the user choose files in place versus a verified copy bundle if copy mode is in release scope. The graphical layer should not duplicate XML conversion rules.
5. **Existing-library update workflow.** Only after observing reimport behavior, add optional import of a user-exported rekordbox XML as a baseline for diff/merge. Preserve unrelated cues, metadata and playlists under an explicit ownership policy. Use track location/content evidence to propose matches; ambiguous matches fail. A SetVector export snapshot being repeatable does not make rekordbox reimport idempotent.
6. **Automatic analysis projections.** Add key/cue/grid estimates only after measured accuracy and abstention thresholds exist for target styles. Grid transfer requires both numerically valid grids and successful destination tests; satisfying one does not satisfy the other.
7. **Target hardware qualification.** If the goal includes USB/CDJ use, import into rekordbox and use its normal device export, then test the named players/controllers. Qualify those targets separately from desktop import.

Minimum real-application acceptance matrix:

| Test group | Observable pass condition |
|---|---|
| Clean import, both OSes | Every expected audio file opens; collection count and displayed playlist order match; every selected cue is at the expected audible impulse/beat. |
| XML round trip | Export the imported Collection back to XML with grid output enabled, normalize the result, and compare supported semantics with the expected snapshot. Record any precision loss and normalization. The serializer parsing its own output is insufficient. |
| Timing | Test native/resampled analysis, silence before first beat, tempo changes, early/middle/late marks, relevant lossy/lossless formats, and long tracks. Predeclare timing tolerance; e.g. an initial 10 ms engineering target is a proposal, not a rekordbox guarantee. Also inspect actual audio at triggers. |
| Metadata | Test all supported key spellings, decimal BPM, point/loop distinction, memory and hot slots, labels and optional colors. Reject or explicitly omit fields outside the tested profile. |
| Reimport | Identical XML twice; same ID/new cue; new ID/same path; same ID/changed path; existing manual cue; renamed playlist; repeated occurrence. Record duplicate, merge, replace and prompt behavior separately. Never prescribe deleting real collection entries as the default workaround. |
| Analysis interaction | Import with intended settings, allow required waveform processing, check whether BPM/key/grids/cues survive, then repeat controlled reanalysis and Analysis Lock scenarios. Establish the exact supported user instructions. |
| File lifecycle | Moved music, missing file, same filename/different bytes, retagged file, copied file, cross-platform relocation and changed drive. Export must identify stale bindings and avoid silent substitution. |
| Cue collisions/limits | More selected cues than a destination supports, duplicate slots and conflicting occurrence-specific cues produce an actionable preflight report rather than silent truncation. |

Suggested module placement is a small `integrations/rekordbox` or `export/rekordbox` adapter, pure domain export contracts, and `application` orchestration. The final package name should follow repository conventions; no new native dependency is inherently required for writing XML. Unit checks protect numerical/schema invariants; the clean-library matrix qualifies actual compatibility. Store synthetic fixtures and normalized exported metadata in Git; keep commercial audio and personal library exports outside Git.

### Gaps

- Research establishes feasibility and the implementation dependency order, not a tested integration guarantee. No synthetic XML, audio fixture, live library import, code change, or user-library mutation was performed in this bounded research task.
- Existing-library overwrite semantics, phrase/native waveform preservation and target hardware behavior remain qualification work. Do not advertise automatic bidirectional synchronization until conflict resolution and repeated imports are proven.
