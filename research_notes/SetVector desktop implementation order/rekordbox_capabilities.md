# Rekordbox interoperability

## Can SetVector deliver tracks, playlists, analysis and cues to rekordbox?

### Takeaway

Yes: rekordbox has a documented XML interchange route appropriate for SetVector. Treat this as a promising, documented integration surface with individual behaviors to certify, rather than claiming that all of SetVector's analysis automatically becomes native rekordbox analysis. The research found documents and historical observations; it did not execute an import in rekordbox.

### Cited Findings

- The official developer page publishes an XML playlist format and import procedure. Its UI wording uses the older “Bridge” name; do not copy that UI path into modern instructions. Duplicate sibling playlist/folder names are prohibited. [Official developer page](https://rekordbox.com/en/support/developer/)
- The current v7 manual documents enabling rekordbox XML under Preferences > View > Layout and choosing Imported Library under Advanced > Database. Tracks can be dragged from XML All Tracks into Collection; XML playlists can be dragged into Playlists. The same manual provides XML export, optional beatgrid export, auto-analysis settings, and Analysis Lock. It describes eight hot cues per track and ten saved memory cue points; hardware capacity varies. See pages 14, 19, 45, 92, 95, 98–99, 239 and 246. [Rekordbox 7 manual](https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf)
- The v6.7.0 manual also documents XML library import and M3U/M3U8/PLS playlist import. This supports using one XML architecture across the two major versions, but is not proof that every v6 release behaves identically. See pages 19, 35–36. [Rekordbox 6.7.0 manual](https://cdn.rekordbox.com/files/20230316171900/rekordbox6.7.0_manual_EN.pdf)
- The v7 FAQ documents File > Export Collection in xml format and says conversion to v7 copies cues, beatgrids and playlists. Library-version migration is a separate mechanism from third-party XML import. [Rekordbox 7 FAQ](https://rekordbox.com/en/support/faq/rekordbox7/)
- Streaming tracks cannot be exported through LINK EXPORT or to USB drives. Plan this integration around accessible local audio files. [Official streaming FAQ](https://rekordbox.com/en/support/faq/streaming-7/)

### Inferences

- Recommend a first release that exports a rekordbox XML file referencing unchanged local songs and containing a generated playlist plus accepted cue/grid/key data. An optional folder of copied audio and a manifest can make transfer to another machine practical, but copying is a separate operation from XML generation.
- M3U8 is a useful playlist fallback; it should not be advertised as the carrier for SetVector cue and beatgrid metadata. The documented rich interchange route is XML.
- Treat “export songs” as packaging/referencing songs, unless the user explicitly wants a rendered mix. Rendering, trimming or re-encoding introduces a different time coordinate system and therefore a different integration problem.

### Gaps

- No real import/export round trip was performed. Exact installed rekordbox version, operating system and target DJ hardware remain unspecified.
- The current manual demonstrates the workflow; it does not give an exhaustive guarantee of precedence or preservation for every XML field.

## What can XML represent, and how should SetVector map its data?

### Takeaway

Keep SetVector's complete analysis in its own format. Export only a validated projection of that analysis into rekordbox fields, with explicit omission/reporting for richer data.

### Cited Findings

- The official XML table defines required track `Location` as a file URI, track `TrackID`, `AverageBpm`, `Tonality`, `Comments`, `Rating`, `Colour`, and descriptive metadata. `TEMPO` contains `Inizio` (seconds), `Bpm`, `Metro` and `Battito`; multiple tempo entries express grids. `POSITION_MARK` contains `Name`, `Type`, `Start`, `End`, `Num`; cue is type 0 and loop type 4. Memory cues use -1; hot cues A–C are explicitly numbered 0–2. Playlist nodes reference collection tracks by ID or location. UTF-8 and escaped XML entities are specified. No waveform, arbitrary analysis-array, phrase-analysis, My Tag or cue-color fields appear in this published table. [Official XML format table](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf)
- The developer table is insufficient to document contemporary hot cue slots D–H; the current UI has A–H. This is a documentation gap, not evidence that D–H cannot be imported. [XML table](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf); [v7 manual, pages 98–99](https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf)
- Pyrekordbox's maintainer documents separate ANLZ files holding waveforms, beatgrids, seeking indices, and cue/loop data. The project is independent of Pioneer/AlphaTheta. [Pyrekordbox repository](https://github.com/dylanljones/pyrekordbox)

### Inferences

Proposed mapping contract:

| SetVector concept | Proposed export | Required check |
| --- | --- | --- |
| Stable local audio identity | Absolute file URI plus stable export ID | File exists; URI decodes to the intended file |
| Set order | Playlist track references in chosen sequence | Compare actual playlist order after import |
| Track BPM and key | Track summary fields | Key spelling and imported value survive |
| Validated beat/downbeat grid | Tempo anchors including beat-in-bar | Inspect beginning, middle and end; BPM alone is insufficient |
| Important transitions / section boundaries | Selected named memory/hot cues | Time, slot and label survive; prioritize within device limits |
| Loop suggestion | Start and end positions | Correct endpoints, type and playback behavior |
| Energy / transition rationale | Short optional comments plus SetVector sidecar | Preserve existing user comments |
| Full feature arrays / confidences | SetVector sidecar | Do not claim native rekordbox equivalents |

- Start from actual rekordbox-exported fixtures for each supported version, supplementing the published table where it is incomplete. Do not infer cue RGB, D–H numbering, key vocabularies or active-loop behavior solely from UI capability.
- Preserve a canonical time measured from the playable audio start. Keep analysis sample rate, decode method and any encoder-delay correction with results. The exporter should not guess an MP3 offset.
- Preserve complete analysis and source provenance independently of this adapter. That allows future exporters without making rekordbox's subset the internal data model.

### Gaps

- Import behavior remains unverified for colors, hot slots D–H, name truncation, multiple memory markers at identical timestamps, loops, dynamic tempo, meter changes, precision, and empty optional fields.
- No official machine-readable XSD or complete modern field-by-field import contract was found. The published table has apparent BPM unit wording errors; do not treat those as instructions to convert BPM into seconds.
- There is no evidence here that SetVector's detailed curves, embeddings or structure labels can become rekordbox's native waveform/phrase/stem analysis.

## What must be proved before building the full integration?

### Takeaway

Build and certify a small XML round trip before spending heavily on the desktop UI. Existing-track updates and audio timing are the highest-value early tests because schema validity cannot establish them.

### Cited Findings

- A historical forum report described existing-track metadata being ignored during playlist import while explicit All Tracks > Import To Collection worked. An official comment acknowledged the issue for 5.7.0 in 2019; another said there was no fix timeline in 2021. This establishes historical failure risk, not the behavior of today's v7. [Historical report and official replies](https://community.pioneerdj.com/hc/en-us/community/posts/22978428247193-Rekordbox-5-7-0-stil-got-XML-import-issues)
- A June 2025 reply on the vendor-hosted community says v7 XML tracks can be imported to update cue information. The retrieved page does not mark this reply as official. It supports testing the current route; it does not establish overwrite/merge semantics. [Rekordbox 7 XML discussion](https://community.pioneerdj.com/hc/en-us/community/posts/47755221672345-Rekordbox-7-XML-Import)
- AlphaTheta documents automatic relocation within configured search folders and manual relocation through Missing File Manager. [Official relocation help](https://pioneer-support.zendesk.com/hc/en-us/articles/8113238460441-How-can-I-use-Auto-Relocate-and-Relocate-to-find-missing-files)
- Pyrekordbox documents SQLCipher-encrypted v6/v7 master databases, limited create/delete table support, and recommends backing up before changes. Its listed tested versions include 5.8.6, 6.7.7 and 7.0.9. This is primary documentation for that independent tool, not a supported AlphaTheta database API. [Pyrekordbox repository](https://github.com/dylanljones/pyrekordbox)

### Inferences

Recommended proof sequence, each producing fixtures and a recorded outcome:

1. Use a disposable library and a few controlled local files. Establish an XML export from the precise rekordbox build and platform under test. Include visibly distinct BPM/key, named memory and hot cues, one loop and a nonalphabetical playlist order.
2. Generate equivalent XML from a minimal SetVector adapter. Import new tracks, then the playlist. Export from rekordbox again and compare semantic values, allowing measured rounding only. Visually inspect grids and listen to cue jumps, because a text comparison cannot prove audible timing.
3. Repeat against already-present tracks with deliberately conflicting manual cues/comments/grid. Test explicit track import separately from playlist import. Record prompts, preserved values, overwritten values, duplicate tracks and duplicate playlists. Reimport the same XML to measure idempotence.
4. Compare Auto Analysis disabled and enabled. Establish the safe order for generating native waveforms and applying SetVector grids/cues. Test Analysis Lock only after establishing what was imported; do not presume the lock itself is available through XML.
5. Exercise MP3 CBR/VBR, WAV and FLAC; Unicode, spaces, percent signs and ampersands; long paths; removable drives; moved files; and a Windows-to-macOS relocation. Track fingerprints should verify identity; filenames or titles alone are unsafe matching keys.
6. Test the intended USB export/player path from rekordbox when hardware use is in scope. Desktop import success is a separate gate from reliable hardware playback.

- Keep a per-version capability profile and a conservative export mode. Until certification, mark advanced fields experimental and provide a human-readable export receipt listing included and omitted items.
- Prefer generating an inspectable XML artifact over writing the live database. The latter introduces encrypted, version-sensitive storage and synchronization responsibilities before the product has proved its essential workflow.
- Playlist order is the DJ's sequence, not a rendered or automatically mixed performance. Pairwise transition suggestions need a clear cue selection policy when one song occurs in multiple sets with different neighbors.

### Gaps

- The official sources reviewed do not specify whether existing-track matching is based strictly on file paths, IDs, content or a combination. Stable SetVector identity cannot be assumed to be native rekordbox identity.
- No present-day official guarantee was found for merging cues, preserving user edits, or synchronizing XML automatically back into the active collection. These should remain explicit test requirements.
- Documentation supports both Mac and Windows workflows, but testing on one platform will not certify path encoding, drive naming, filesystem permissions or case behavior on the other.
