# Standalone desktop analysis integration

## What can the desktop app reuse from SetVector today?

### Takeaway

Build the standalone app as a client of the existing application services and immutable artifacts. A packaged Python analyzer process is the safest common integration boundary for either a webview desktop shell or a Python/Qt interface; rewriting the numerical engine is unnecessary.

### Cited Findings

- The architecture explicitly keeps UI and rendering outside numerical modules, requires offline execution after installation, identifies a visual local app as a UI adapter over application APIs, and targets a first planning collection of 200–2,000 tracks. It leaves format and performance support to a release decision. [Repository architecture](../../docs/architecture.md)
- `analyze_track(path, config, store) -> AnalysisOutcome` inspects the asset, computes the feature identity, loads a valid cached artifact before decoding, or decodes/extracts/saves. The outcome contains the asset, feature bundle, manifest path, and cache-hit flag. [Analysis service](../../src/setvector/application/analyze.py)
- `render_report(feature_id, store, output=..., audio=..., include_audio=..., overwrite=...)` reads stored features without reanalysis. An explicit audio path supports relocated files, and `include_audio=False` permits feature inspection without the original audio. [Report service](../../src/setvector/application/report.py)
- The CLI already emits structured JSON results on stdout and errors/warnings on stderr. Its commands are synchronous and do not expose a persistent job protocol, granular progress, or a cancellation token. [CLI](../../src/setvector/cli/__init__.py)
- The present feature identity incorporates the content hash and extractor identity; extractor identity includes algorithm/package/configuration/parameter/dependency versions. The current implementation does not record all the stronger code-revision/dirty-source provenance described by the architecture. [Identity implementation](../../src/setvector/analysis/identity.py), [canonical identity](../../src/setvector/storage/canonical.py), [architecture](../../docs/architecture.md)
- `ArtifactStore` validates manifests and arrays, loads NumPy with `allow_pickle=False`, verifies temporary writes, and publishes a sibling directory with `os.replace`. The persisted asset has one `observed_path`; comparisons deliberately exclude that location from identity. [Artifact store](../../src/setvector/storage/artifacts.py)
- Current reports contain feature curves, beats, diagnostics and provenance, with filename-derived artist/title. `downbeats` is currently empty and the bar estimate is calculated from global tempo and duration. These are not an implemented music-tag catalog or validated downbeat analysis. [Report model](../../src/setvector/visualization/model.py)

### Inferences

- Introduce a separate desktop adapter package and a versioned worker protocol. Keep ownership of numerical, decoder, feature-schema, and cache-identity changes with the current analysis work. Desktop development can begin with the current CLI or an external wrapper around the Python API. This follows the existing dependency direction. [Architecture](../../docs/architecture.md), [analysis service](../../src/setvector/application/analyze.py)
- Use `feature_id` as the durable link between library entries and results. Keep UI selection, queue status, imported tags, playlists, and file locations in a desktop catalog; do not modify feature manifests to record app state. A relocated identical file can then retain results while the app updates its location record. [Artifact store](../../src/setvector/storage/artifacts.py)
- Version the worker protocol separately from artifact schemas. A startup handshake should identify supported protocol, analyzer/package versions, supported commands, and decoder capabilities. Reject incompatible operations with an actionable error instead of guessing at schema compatibility. [Domain contracts and architecture](../../docs/architecture.md)

### Gaps

- No desktop integration, installer, benchmarks, or native playback was executed in this research. The audited working tree was clean at commit `96e60400bde4f83ec15719fce81fd3cba8fd6c60`; ongoing analysis development may alter these interfaces. Re-check the narrow application boundary when implementation begins.
- API stability has not been declared. Agree on a small compatibility contract before two independent implementations evolve.

## How should library import, indexing, and artifact reuse work?

### Takeaway

Use a local SQLite catalog for mutable library and job records, and keep the existing artifact directory as the authoritative store of analysis results. Import should identify files progressively and preserve separate concepts for a track entry, a file location, and an immutable content identity.

### Cited Findings

- Current inspection hashes the entire file in 1 MiB blocks and obtains duration, sample rate, channels, format, and subtype from SoundFile. Decoding verifies the hash before and after its full read. A cache hit still performs inspection/hash work. [Audio ingestion](../../src/setvector/ingestion/audio.py)
- SQLite WAL allows readers and a writer concurrently but only one writer at a time; it is unsuitable for a shared database over a network filesystem. The current official documentation also identifies a rare WAL reset race fixed in 3.51.3 and selected backports. [SQLite WAL](https://sqlite.org/wal.html)
- Qt filesystem watchers can stop watching a renamed/deleted file and may coalesce rapid directory changes. Watches have platform resource limits and can fail. [QFileSystemWatcher](https://doc.qt.io/qt-6/qfilesystemwatcher.html)
- Mutagen reads metadata for many audio/container formats, including MP3, FLAC, MP4, Ogg, AIFF and WAVE; its overview identifies GPL version 2 or later licensing. It is a metadata library, not evidence that the analyzer decodes every listed format. [Mutagen overview](https://mutagen.readthedocs.io/en/latest/)
- Platformdirs supplies platform-specific user-data, cache, configuration and log locations, including path-object APIs. [Platformdirs tutorial](https://platformdirs.readthedocs.io/en/latest/tutorial.html)

### Inferences

- Suggested import flow: native file/folder selection → background enumeration → cheap file/stat/metadata rows → asynchronous content identification → deduplication → queued analysis. Make tracks visible before every file has been hashed. File size and modification time can identify rescan candidates, but retain the analyzer's content verification for artifact reuse. [Audio ingestion](../../src/setvector/ingestion/audio.py)
- Suggested catalog entities: `library_tracks` with a stable app ID; `asset_locations` with path/root/availability and observed stat values; `assets` keyed by content hash; `analysis_refs` keyed by feature ID; `jobs`; `playlists` and occurrence records; `annotations`. A path can change, multiple paths can hold the same bytes, and retagging currently changes file identity. Preserve these distinctions rather than treating a pathname or filename as the track's permanent ID. [Architecture](../../docs/architecture.md), [artifact store](../../src/setvector/storage/artifacts.py)
- Keep one catalog owner/writer in the app service. Workers return artifact IDs and summaries, and do not concurrently mutate the library catalog. A completion transaction records the published artifact. On restart, reconcile published artifacts against interrupted jobs, because catalog commit and directory publication are separate operations. [SQLite WAL](https://sqlite.org/wal.html), [artifact publication](../../src/setvector/storage/artifacts.py)
- Begin with explicit import/rescan; add watchers as rescan hints. Preserve missing files and their analysis history, present a relink operation, and reconcile folders after mount/restart. Do not assume every rename produces a reliable identity event. [QFileSystemWatcher](https://doc.qt.io/qt-6/qfilesystemwatcher.html)
- Keep the catalog, annotations, and playlists in user data; use cache storage for regenerable waveform tiles and previews. Preserve expensive analysis artifacts according to an explicit retention setting rather than silently evicting them with temporary previews. Store the active catalog on a local disk outside synced/network folders. Back up with a database-aware operation rather than copying only the main file during active WAL use. [Platformdirs](https://platformdirs.readthedocs.io/en/latest/tutorial.html), [SQLite WAL](https://sqlite.org/wal.html)
- Read tags through a separate adapter and retain tag provenance. A stored BPM tag, analyzer tempo, and user correction should remain distinguishable. Mutagen is technically suitable, but its license needs a distribution decision; do not add it as an unquestioned Apache-compatible dependency. [Mutagen](https://mutagen.readthedocs.io/en/latest/), [annotation requirements](../../docs/architecture.md)

### Gaps

- No metadata dependency is selected. TagLib or an appropriately licensed alternative could be evaluated alongside Mutagen.
- No timings establish that SQLite is required by collection size alone; its immediate value here is persistent jobs, search and mutable app state. Catalog migrations, backup policy and disk quotas remain product/implementation work.

## How should background work, progress, cancellation, and IPC behave?

### Takeaway

Keep expensive analysis outside the UI process and start with one active analysis worker. Persist jobs, pass small typed messages, and use existing atomic artifacts to recover completed work across cancellation or crashes.

### Cited Findings

- Tauri supports bundling platform-specific external binaries as sidecars, spawning them from Rust, reading stdout events and writing stdin. Sidecar packaging names include the platform target triple. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- Tauri's frontend/core boundary uses asynchronous messages with JSON-compatible data. [Tauri IPC](https://v2.tauri.app/concept/inter-process-communication/)
- Python multiprocessing runs on Windows/macOS, where spawn is the default. Its documentation warns that terminating a process using a multiprocessing queue can corrupt the queue and that frozen executables have platform/start-method limitations. [Python multiprocessing](https://docs.python.org/3/library/multiprocessing.html)
- PyInstaller documents its own multiprocessing support through `freeze_support()` on all platforms and warns about recursive spawning when this is omitted. This is more specific than Python's generic frozen-executable warning; neither source establishes that an arbitrary frozen dependency stack will work untested. [PyInstaller process caveats](https://pyinstaller.org/en/latest/common-issues-and-pitfalls.html)
- The current analyzer exposes only a synchronous application call, and publishes validated complete artifacts. Its numerical loops already process spectral frames and tempograms in bounded chunks, while the decoder still holds the complete audio. [Analysis service](../../src/setvector/application/analyze.py), [baseline extraction](../../src/setvector/analysis/baseline.py), [artifact store](../../src/setvector/storage/artifacts.py)

### Inferences

- Concrete process layout: desktop window/rendering → app coordinator/catalog → packaged analyzer executable → existing Python application services/artifacts. Keep native playback independently responsive. A Tauri shell can supervise a sidecar; a Qt shell can supervise the same executable. This preserves the same scientific implementation and worker protocol across UI choices. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/), [SetVector application boundary](../../docs/architecture.md)
- First implementation: one executable invocation per track, reusing the current JSON CLI outputs. This offers straightforward failure isolation and hard cancellation at the cost of Python/scientific-library startup per track. Later, benchmark a long-lived worker that processes sequential jobs; do not assume startup cost is negligible or expensive without measurement. [CLI](../../src/setvector/cli/__init__.py), [sidecar spawn](https://v2.tauri.app/develop/sidecar/)
- Protocol proposal: UTF-8 newline-delimited JSON on stdin/stdout, diagnostics on stderr; messages include protocol version, request ID, job ID, command/stage, elapsed time, and terminal status. Pass paths, config, artifact IDs, small summaries and bounded chart payloads. Keep PCM arrays and full NPZ contents out of ordinary control messages. Invoke an executable with an argument array and never construct a shell command from a music filename. [Existing JSON CLI](../../src/setvector/cli/__init__.py), [Tauri sidecar arguments](https://v2.tauri.app/develop/sidecar/)
- Job states: queued → running → completed/failed/cancelled/interrupted, with persisted timestamps and retry count. Immediately cancel unstarted jobs; expose track-level progress honestly today. True stage percentages and prompt cooperative cancellation require future callbacks/checkpoints in the application service. An external wrapper cannot interrupt a synchronous numerical call cooperatively without support inside it. [Synchronous service](../../src/setvector/application/analyze.py)
- Hard cancellation should kill only the dedicated worker, discard its process-local IPC state, and preserve already published artifacts. On restart, validate completed artifacts and clean orphaned temporary directories after ensuring they have no live writer. A published feature followed by a missing success message should reconcile to completion. Avoid a killable shared multiprocessing queue as the primary app control channel. [Python termination warning](https://docs.python.org/3/library/multiprocessing.html), [artifact publication](../../src/setvector/storage/artifacts.py)
- Do not fork a running GUI. Prefer a separately packaged command now; if using multiprocessing later, explicitly test spawn/freezing with the selected runtime. Run only one numerical worker until measured memory/CPU budgets justify bounded parallelism. [Python multiprocessing](https://docs.python.org/3/library/multiprocessing.html), [PyInstaller](https://pyinstaller.org/en/latest/common-issues-and-pitfalls.html), [execution architecture](../../docs/architecture.md)

### Gaps

- Cooperative cancellation latency, progress granularity, worker startup time and per-track peak memory have not been measured. They must not be promised as existing capabilities.
- The current store catches Python exceptions to clean up temporary directories; abrupt process termination can bypass that cleanup. Cancellation during publication needs a packaged-app recovery test.

## How should playback, waveforms, reports, and format support integrate?

### Takeaway

Reuse the current report for the earliest desktop slice, then separate in-app chart data from portable HTML export. Provide a single preview player synchronized to the report's source-time coordinates; a performance-grade DJ deck would be a separate project.

### Cited Findings

- Reports inline uPlot, CSS, JavaScript, fonts, typed-array feature data and base64 audio. The browser converts embedded audio into a Blob and HTML audio player, and uses player time to update chart position. [HTML assembly](../../src/setvector/visualization/html.py), [report JavaScript](../../src/setvector/visualization/assets/report.js)
- Preview creation reads verified source bytes into memory. Existing MP3 bytes pass through; other supported formats decode and encode an MP3 preview in memory. [Preview adapter](../../src/setvector/ingestion/preview.py)
- Qt `QWebEngineView.load` can navigate to a document; `setHtml` instead turns the HTML into a data URL and cannot display content larger than its documented 2 MB limit. [QWebEngineView](https://doc.qt.io/qt-6/qwebengineview.html)
- Qt WebChannel provides asynchronous communication between HTML JavaScript and published Qt objects using JSON-convertible values. [Qt WebChannel](https://doc.qt.io/qt-6/qtwebchannel-javascript.html)
- `QMediaPlayer` supports local-file sources, play/pause/stop, seeking when supported, periodic position signals measured in milliseconds, playback state and error signals. [QMediaPlayer](https://doc.qt.io/qt-6/qmediaplayer.html)
- Qt Multimedia currently uses FFmpeg by default on desktop. Qt says codec support can differ across platforms and recommends testing target platforms; the Windows Media Foundation backend is deprecated since Qt 6.10. Bundled FFmpeg libraries are a deployment responsibility. [Qt Multimedia backends](https://doc.qt.io/qt-6/qtmultimedia-index.html)
- libsndfile documents WAV/AIFF, FLAC, Ogg Vorbis, Opus and MP3 support, with MP3 read/write introduced in 1.1.0. SoundFile exposes runtime available-format queries and block reads. [libsndfile formats](https://libsndfile.github.io/libsndfile/formats.html), [SoundFile](https://python-soundfile.readthedocs.io/en/latest/)

### Inferences

- Stage-one report reuse can load the generated local HTML file. For Qt specifically, use file navigation rather than feeding an audio-heavy report into `setHtml`. Keep the report's existing player for this proof, and verify actual MP3 decoding in the packaged webview on both systems. [QWebEngineView](https://doc.qt.io/qt-6/qwebengineview.html), [current report](../../src/setvector/visualization/html.py)
- Production in-app charts should load a small reusable view and request report-model data by feature ID. Play the original file or a separately cached preview through a playback adapter. Keep self-contained, audio-embedded HTML as explicit export. This avoids rebuilding and retaining a large audio-bearing HTML document every time the user selects a track. [Report service](../../src/setvector/application/report.py), [preview implementation](../../src/setvector/ingestion/preview.py)
- If selecting Qt, use QMediaPlayer/QAudioOutput as the transport and a narrow WebChannel bridge for seek commands and source-time updates. For Tauri, the initial HTML player can remain, with a separately scoped local media-delivery mechanism; a native Rust/OS playback backend needs an independent compatibility proof. The same `play/pause/seek/position/duration/error` adapter contract should hide this difference. [QMediaPlayer](https://doc.qt.io/qt-6/qmediaplayer.html), [Qt WebChannel](https://doc.qt.io/qt-6/qtwebchannel-javascript.html), [Tauri IPC](https://v2.tauri.app/concept/inter-process-communication/)
- Keep one authoritative playback clock. Chart frame interpolation is display-only; on pause, seek and source change, resynchronize to the player. Use source seconds internally and convert Qt milliseconds at the adapter boundary. Verify transcoded preview alignment and compressed-file seek behavior before cue editing. [SetVector timing contract](../../docs/architecture.md), [QMediaPlayer position](https://doc.qt.io/qt-6/qmediaplayer.html)
- The current overview is constructed from analysis features; it is not a stored PCM waveform artifact. Add optional multiresolution min/max waveform envelopes as independent display artifacts keyed by audio/decoder/envelope versions. These can be produced with block reads and loaded only at the visible resolution. Do not relabel an RMS curve as an exact waveform. [Report model](../../src/setvector/visualization/model.py), [SoundFile block I/O](https://python-soundfile.readthedocs.io/en/latest/)
- Define separate capabilities for metadata-readable, analyzable and playable. Prioritize tested WAV, AIFF, FLAC and MP3 for a first matrix; only advertise other formats after installed-build fixtures pass. AAC/M4A is absent from the cited libsndfile support list, so it cannot be promised by the current decoder. If required, add an isolated decoder adapter with explicit version/channel/sample-rate/gapless rules instead of changing scientific inputs silently. [libsndfile formats](https://libsndfile.github.io/libsndfile/formats.html), [decoding policy](../../docs/architecture.md)

### Gaps

- Native playback is feasible from the cited APIs but has not been prototyped here. Frame-accurate scrubbing, gapless preview, time stretching, device switching, and sample-accurate dual-deck mixing are not established features.
- No source in this audit establishes Tauri asset-protocol range-request behavior for this app. Test seekable local audio delivery in both WebView2 and WKWebView before committing to that path.
- Full-track preview transcodes and HTML base64 copies are resource costs visible in code, but no measured resident-memory multiplier is available.

## How should portability and resource limits shape the implementation stages?

### Takeaway

Ship a narrow complete offline workflow first: import, queue, analyze, inspect, preview, relink and restart recovery. Resource budgets and installed-build behavior should determine later concurrency and streaming work.

### Cited Findings

- The decoder reads complete float32 audio and `DecodedAudio` makes a contiguous copy; spectral and tempogram loops are already chunked. Thus there is progress on bounded temporary numerical arrays, but decoding is not fully streaming. [Audio ingestion](../../src/setvector/ingestion/audio.py), [baseline extraction](../../src/setvector/analysis/baseline.py)
- Windows long-path handling depends on the application and APIs; Microsoft documents manifest/OS opt-in and Unicode path behavior. [Windows maximum path documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
- A sandboxed macOS app can persist user-selected file access with security-scoped bookmarks, resolving stale bookmarks and balancing start/stop-access calls; sharing access with a child process requires appropriate handling. This applies when App Sandbox is adopted, not to every notarized desktop app automatically. [Apple file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- Project requirements preserve original audio, allow user-selected source paths, require Unicode/space-safe handling, and recommend measuring runtime, peak memory and artifact size on target hardware. [Architecture](../../docs/architecture.md)

### Inferences

- Resource arithmetic, not a benchmark: five minutes of stereo 44.1 kHz float32 PCM is `300 × 44100 × 2 × 4 = 105,840,000` bytes, about 101 MiB for one buffer. One hour is about 1.18 GiB per buffer. Copies, resampling, preview bytes and Python/native-library state add to this floor. Therefore begin with one worker and a duration/rate/channel-based admission estimate, while profiling the actual installed build. [Decoder allocation behavior](../../src/setvector/ingestion/audio.py)
- Do not increase workers to the CPU count automatically. Keep playback/UI headroom, restrict concurrent report transcodes, load one detailed chart at a time, and put a disk quota on derived previews/waveform caches. Increase concurrency only after representative measurements. [Execution/resource guidance](../../docs/architecture.md)
- Use path objects and native URL constructors, preserve original path spelling, and keep filesystem identity distinct from normalized search strings. Test spaces, Hindi/Unicode names, removable volumes, changed drive letters, very long Windows paths, permissions, read-only music folders and files that are unavailable locally. Implement relink rather than trying to make absolute paths portable across operating systems. [Repository path requirements](../../docs/architecture.md), [Windows paths](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation), [Apple bookmarks](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)

### Inferences: staged implementation proposal

1. **Contract and packaged vertical slice.** Freeze a compatible analyzer revision after current fixes; wrap existing APIs/CLI in a separate desktop area. Package the engine on Windows and macOS, import one file, analyze outside the UI, load its offline report and play preview audio with network blocked. Record version/codec capabilities. No numerical rewrite is needed. [Application service](../../src/setvector/application/analyze.py), [report service](../../src/setvector/application/report.py), [offline requirement](../../docs/architecture.md)
2. **Library and durable queue.** Add the local catalog, progressive folder import, one active worker, cancellation, partial-failure reporting, restart reconciliation, deduplication and relinking. Preserve successful immutable artifacts. Test cancellation while decoding, analyzing and publishing, and relaunch after a forced worker exit. [Artifact store](../../src/setvector/storage/artifacts.py), [SQLite](https://sqlite.org/wal.html)
3. **Integrated inspection and playback.** Separate in-app chart/model loading from portable report export, introduce the transport adapter, cache preview/waveform artifacts, and add tag import with a deliberate dependency choice. Confirm source-time alignment and installed codec support on each target. [Report model](../../src/setvector/visualization/model.py), [Qt playback API](https://doc.qt.io/qt-6/qmediaplayer.html), [format capabilities](https://libsndfile.github.io/libsndfile/formats.html)
4. **Measured scaling.** Benchmark the intended 200–2,000-track collection workload and long recordings; then choose persistent workers, limited parallel jobs, decoder streaming or chunked display data. Preserve existing extractor outputs/identities unless an explicitly reviewed algorithm change is required. [Architecture](../../docs/architecture.md), [current chunked extraction](../../src/setvector/analysis/baseline.py)

### Gaps

- Minimum Windows/macOS versions, Intel-Mac support, supported sample-rate/channel/duration limits, desired batch time, installer size and memory ceilings remain unspecified. These require product targets and measured packaged builds, not estimates presented as guarantees.
- The integration recommendation is UI-neutral. Tauri offers direct reuse of the web report plus a sidecar boundary; Qt offers a Python-centric route and a documented local playback API, but adds its own web-engine/media deployment surface. A packaging spike should decide between these without changing the analysis engine.
- Existing analysis bugs/fixes are intentionally outside this work. Proposed callbacks, decoder expansion, waveform artifacts and schema changes are future coordination points, not changes made by this research.
