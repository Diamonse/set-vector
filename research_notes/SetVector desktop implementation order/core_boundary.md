# Desktop analysis boundary and durable local state

## Which existing contracts can the desktop use now?

### Takeaway

The first installed workflow can call the current CLI without changing the analysis engine. A durable desktop version should introduce a small worker wrapper around the same application services, with a separately versioned control protocol. This audit inspected clean revision `cc1bab56caf7b9080f419d4a7aa2d779f93b4964`; source and existing tests were read, but no desktop prototype or performance experiment was run.

### Cited Findings

- `analyze_track(path, config, store)` returns `AnalysisOutcome(asset, features, manifest_path, cache_hit)`. It inspects the file, computes the expected feature identity, calls `store.load`, then decodes/extracts/saves only on a miss. It accepts no progress callback, cancellation token, or pre-inspected asset. [Analysis service](../../src/setvector/application/analyze.py)
- The CLI's `analyze AUDIO --config CONFIG --workspace ROOT` prints exactly the useful small result fields `asset_id`, `feature_id`, `cache_hit`, `manifest_path` as JSON on stdout. Warnings go to stderr. CLI failures are coarse: invalid inputs/configuration generally exit 2 through argparse, expected processing errors exit 1, and caught KeyboardInterrupt exits 130. This is usable for a spike but does not expose structured error codes. [CLI](../../src/setvector/cli/__init__.py)
- `render_report(feature_id, store, output=None, audio=None, include_audio=True, overwrite=False)` loads stored features without analysis. Default output is `<workspace>/reports/<feature-id>.html`. A moved source can be supplied using `audio`; its bytes must match the analyzed asset. `include_audio=False` lets results remain inspectable when audio is missing. Existing output raises an input error unless replacement is explicitly requested. [Report service](../../src/setvector/application/report.py), [report tests](../../tests/test_application_report.py)
- `ArtifactStore.load_stored(feature_id)` validates and loads the stored asset plus bundle without reading source audio. The store has no lightweight summary/list API; loading a bundle includes decoding its arrays. Persistent layout is `assets/<asset-id>/asset.json` and `features/<feature-id>/{manifest.json,arrays.npz}`. [Artifact store](../../src/setvector/storage/artifacts.py)
- Cache identity is SHA-256 of asset identity plus extractor identity, including config, algorithm version, package version, parameters and dependency versions; file paths are excluded. Whole-file bytes determine asset identity. Cache hits still hash/inspect the source. The saved asset's original `observed_path` remains unchanged when the same content is found at another location. [Identity](../../src/setvector/storage/canonical.py), [extractor identity](../../src/setvector/analysis/identity.py), [ingestion](../../src/setvector/ingestion/audio.py), [storage tests](../../tests/test_storage_artifacts.py)
- Current feature/domain contracts reject unknown fields and every schema version except integer 1. An apparently additive scientific field is therefore not transparently compatible with an old reader. Artifact, worker, report-view, and catalog compatibility need separate treatment. [Validation](../../src/setvector/domain/_validation.py), [bundle types](../../src/setvector/domain/bundle.py)
- `build_report_model(asset,bundle)` computes display summaries without reading source audio; it includes encoded series, warnings, beats and provenance. It derives title/artist from filenames, has empty downbeats, and estimates bars from tempo and duration. These are not music-tag extraction or validated downbeat detection. [Report model](../../src/setvector/visualization/model.py)
- `load_preview` reads the complete source bytes and verifies their hash. MP3 is passed through; other supported formats are decoded and encoded as MP3 in memory. The HTML renderer embeds audio, arrays, scripts, styles and fonts. Thus report creation remains expensive even when the scientific artifact is cached. [Preview](../../src/setvector/ingestion/preview.py), [HTML renderer](../../src/setvector/visualization/html.py)
- Existing tests cover reuse without decode/extraction, relocated source reuse, changed configuration/content, corrupt cache refusal, report creation without analysis and network-blocked CLI operation. Their existence does not prove installed Qt operation, hard process termination, or power-loss recovery. [Analysis tests](../../tests/test_application_analyze.py), [offline tests](../../tests/test_offline_analysis.py), [storage tests](../../tests/test_storage_artifacts.py)

### Inferences

- Keep the initial installed slice to file selection → CLI analysis → CLI report → local report display. It establishes whether the bundled scientific libraries, decoder, webview and preview actually work together before a catalog or polished library UI hides packaging problems. [Current CLI](../../src/setvector/cli/__init__.py), [prior report](../../reports/SetVector%20standalone%20analysis%20integration.md)
- For the durable version, expose worker operations `analyze`, `render_report`, and `read_summary` around application services and `ArtifactStore.load_stored`. Add `inspect` only if imports need verified content identity before analysis. Keep NPZ and PCM out of control messages. Return cached small library summaries so browsing 2,000 tracks does not load 2,000 bundles. [Service seam](../../src/setvector/application/analyze.py), [report model](../../src/setvector/visualization/model.py)
- Run report/preview work outside the GUI as well as extraction. Generate reports on demand and cache them separately from scientific results; a preview failure should leave an already completed analysis usable. Key a report cache by feature ID, renderer/build version and audio mode, because feature ID alone does not encode HTML/template changes. [Report service](../../src/setvector/application/report.py), [HTML renderer](../../src/setvector/visualization/html.py)

### Gaps

- No stable public API guarantee, summary contract, report-cache identity, structured worker errors, cooperative cancellation or granular progress API exists at the inspected revision.
- The source snapshot does not prove which file Claude Code is currently editing. Recheck Git state and agree on owned files before implementation.

## What worker protocol and recovery rules should be implemented first?

### Takeaway

Use one dedicated process per job, supervised asynchronously, with one active expensive job initially. Introduce a minimal versioned protocol when the persistent queue is built; recovery must handle the gap between artifact publication and catalog commit.

### Cited Findings

- Qt QProcess accepts a program plus argument list, exposes separate stdout/stderr readiness signals, and reports start/crash failures. Its blocking waits can freeze a GUI thread. On Windows `terminate()` posts WM_CLOSE, which console workers may not handle; such workers require `kill()`. [QProcess](https://doc.qt.io/qt-6/qprocess.html)
- Artifact publication writes and verifies a temporary sibling directory, then renames it into place. Python exception cleanup removes temporary directories, but a forced process death can bypass that cleanup. Asset publication and feature publication are separate. Files are fsynced, while no parent-directory fsync is visible. The code should not be described as proven power-loss durable. [Artifact publication](../../src/setvector/storage/artifacts.py)
- A corrupt/incompatible published artifact raises `ArtifactError`; `analyze_track` does not overwrite or silently repair it. There is no existing durable job-to-result receipt. [Artifact store](../../src/setvector/storage/artifacts.py), [corruption test](../../tests/test_application_analyze.py)
- Existing exception classes distinguish `UnsupportedAudioError`, `InputError`, `DecodeError`, `AnalysisError`, `ArtifactError`. Corrupt, missing and incompatible artifact details are not all represented by separate exception subclasses. [Errors](../../src/setvector/domain/errors.py)

### Inferences

The following protocol is a design proposal, grounded in the existing synchronous service and independent artifact store. It does not require a daemon, web server, task broker, or multiprocessing queue. [Application service](../../src/setvector/application/analyze.py), [artifact store](../../src/setvector/storage/artifacts.py)

1. **Launch and handshake.** Start a packaged executable by absolute path and argument array. It emits a flushed UTF-8 JSON `hello` line containing `protocol_major`, `protocol_minor`, exact engine/build identity, supported operations, readable/writable artifact schemas, and capabilities such as `cooperative_cancel:false`, `stage_progress:false`. The coordinator validates compatibility before sending one request. Protocol version is independent of scientific schema and engine package version. Pin UI/worker as one tested release initially; a package version alone is insufficient because source edits may retain it. [QProcess](https://doc.qt.io/qt-6/qprocess.html), [current extractor identity](../../src/setvector/analysis/identity.py)
2. **Request and framing.** Send one newline-terminated JSON request with `job_id`, unique `attempt_id`, operation, absolute paths, validated config/config ID, and optional expected asset/feature identity. The worker emits `accepted`, then one terminal `result` or `error`. Keep stdout protocol-only and stderr diagnostics-only; flush messages, assemble partial lines, bound frame size, and reject malformed or mismatched attempt IDs. A process can die before writing an error; the supervisor must create its own `worker_crashed`/`worker_start_failed` outcome. Treat a zero exit without a valid result as a protocol failure. [Current JSON CLI](../../src/setvector/cli/__init__.py), [QProcess](https://doc.qt.io/qt-6/qprocess.html)
3. **Honest progress.** Show started/running, elapsed time, completed-track counts, and the final cache-hit flag. The wrapper cannot report decode/extract/publish stages from inside today's synchronous call. Do not add fake percentages or claim heartbeat silence proves a hung numerical task. Stage callbacks and cooperative cancellation should be a later, explicit core change. [Analysis service](../../src/setvector/application/analyze.py)
4. **Result.** Return asset ID, feature ID, validated artifact reference, cache-hit flag, bounded warnings and a small versioned display summary. Do not return the complete FeatureBundle as JSON. Have the worker use the engine's reader to validate results, keeping schema-dependent parsing out of the UI. For installed protocol v1, require a recognized result plus normal successful process completion before catalog completion; unusual exits trigger reconciliation. [Outcome](../../src/setvector/application/analyze.py), [storage validation](../../src/setvector/storage/artifacts.py)
5. **Persist state before launch.** Catalog states are `queued → starting → running → completed | failed | cancelled | interrupted`; `cancel_requested` is a persisted intermediate state for a running process. `starting` covers a crash between database update and process acceptance. A retry creates a new attempt ID while retaining the logical job ID and prior diagnostic information. `cache_hit` is result metadata, not a separate job state. [Existing publication boundary](../../src/setvector/storage/artifacts.py)
6. **Cancel correctly.** A queued job cancels without launching. An active job records cancel intent, kills its dedicated worker using platform-correct handling, and waits asynchronously for confirmed exit. The first protocol advertises no cooperative cancellation. If a valid published result already exists, retain it and mark the job completed with a late-cancellation indication; otherwise mark cancelled. Treat success/cancellation ordering through one coordinator transition function so a late event cannot overwrite the terminal state. Define this visible policy before coding. [QProcess termination semantics](https://doc.qt.io/qt-6/qprocess.html), [atomic publication](../../src/setvector/storage/artifacts.py)
7. **Bridge publication and catalog completion.** After the core returns, the worker should atomically write a small per-attempt completion receipt beside desktop job state, containing request/build identity, asset/feature IDs and artifact reference, before emitting terminal stdout. This receipt belongs to the desktop adapter and is not a scientific manifest. The coordinator validates the artifact and commits the analysis reference plus completion in one SQLite transaction. A receipt makes recovery possible when stdout or the UI is lost. [Separate scientific publication](../../src/setvector/storage/artifacts.py)
8. **Handle the remaining crash window honestly.** Death after feature publication but before the receipt remains possible. If a previously recorded expected feature ID exists, validate it and complete the job. If source identity and exact engine/config are known, retry the same request and let `analyze_track` reuse its cache. If identity is not known, mark interrupted rather than assuming that whichever file now occupies the pathname is the original job's asset. An explicit requeue can be a new request. Computing expected IDs requires engine-owned inspection/identity code; do not reproduce that algorithm in the UI. [Content identity](../../src/setvector/storage/canonical.py), [cache path](../../src/setvector/application/analyze.py)
9. **Restart and ownership.** Prevent two desktop coordinators from managing one catalog. Reconcile old starting/running/cancel-requested attempts only after proving the prior worker is gone; do not kill by a stale PID alone. Treat unidentified leftovers as interrupted. Do not delete temporary artifacts while any process could still be publishing them. A first version may leave orphaned temporary files for a later maintenance pass. Qt's file lock can coordinate app instances when all participants use it; long-lived locks need `setStaleLockTime(0)`, and its Windows non-ASCII-hostname stale-lock limitation requires testing. [QLockFile](https://doc.qt.io/qt-6/qlockfile.html), [artifact temporaries](../../src/setvector/storage/artifacts.py)

Suggested stable errors: map existing typed classes to `unsupported_audio`, `invalid_input`, `decode_failed`, `analysis_failed`, `artifact_error`; add supervisor-owned `worker_start_failed`, `worker_crashed`, `protocol_mismatch`, `protocol_invalid`, and `interrupted`. Check UnsupportedAudioError before its InputError base. Distinguish `invalid_config` during wrapper validation. Return `code`, safe user message and diagnostic reference; never recover by parsing English exception text. More specific `artifact_corrupt` versus `artifact_incompatible` requires new typed core errors or validator changes. Cancellation is a job outcome. These are proposed mappings, not existing CLI behavior. [Typed errors](../../src/setvector/domain/errors.py), [CLI exception mapping](../../src/setvector/cli/__init__.py)

The highest-value new tests are a fragmented protocol line, mismatched attempt ID, exit without result, cancellation before start/during work/after publication, crash after receipt before database commit, and source replacement before interrupted-job retry. Test these with a deterministic fake worker before expensive real audio runs. Then repeat publication and installed-runtime cases using the real worker. This targets state-machine risks absent from the current core tests. [Existing storage tests](../../tests/test_storage_artifacts.py), [CLI tests](../../tests/test_cli.py)

### Gaps

- No measured startup, cancellation or memory budget exists. One process per job is the initial simplicity choice; repeated scientific-library startup should be benchmarked before considering a persistent worker.
- Reliable orphan-worker containment after UI crash needs a platform implementation and packaged failure test. A normal QProcess destructor is not evidence that all abnormal parent deaths kill the child.
- A wrapper can pre-inspect to record expected identity, but `analyze_track` will inspect again. Avoid duplicating core orchestration merely to eliminate that overhead; measure it and propose a core-owned preparation seam later if justified.

## Which catalog concepts are necessary for 200–2,000 tracks?

### Takeaway

SQLite is justified by durable jobs, relinking and mutable library state, rather than any demonstrated query-performance limit at 2,000 tracks. Keep dense measurements in the existing artifact store and begin with a small schema and one catalog owner.

### Cited Findings

- The project targets 200–2,000 local tracks; its architecture calls for SQLite when catalog lookup needs it and an independent UI adapter when a visual app is requested. It requires raw measurements to remain separate from later calibration/scoring. [Architecture](../../docs/architecture.md)
- WAL permits readers alongside one writer; it does not work across a network filesystem. [SQLite WAL](https://sqlite.org/wal.html)
- Foreign-key enforcement must be deliberately enabled on each connection; applications should not assume the default. [SQLite foreign keys](https://sqlite.org/foreignkeys.html)
- SQLite reserves `user_version` for application use. Python's sqlite3 backup API can back up a database while other clients access it, including on the project's minimum Python 3.11 runtime. [SQLite pragma](https://sqlite.org/pragma.html#pragma_user_version), [Python 3.11 sqlite3 backup](https://docs.python.org/3.11/library/sqlite3.html#sqlite3.Connection.backup)

### Inferences

Proposed minimum durable schema, reflecting existing identity rules and separate artifact storage: [Asset model](../../src/setvector/domain/audio.py), [feature identity](../../src/setvector/storage/canonical.py), [artifact store](../../src/setvector/storage/artifacts.py)

| Entity | Minimum purpose and fields | Why needed now |
|---|---|---|
| `assets` | `asset_id` primary key; immutable source size/format/rate/channels/duration metadata | Identical bytes at several paths share analyses |
| `locations` | Stable `location_id`, absolute observed path, nullable `asset_id`, observed size/mtime, availability, last verification | Discovered rows appear before hashing; missing/moved/replaced files do not erase results |
| `analysis_refs` | `feature_id` primary key, asset/config IDs, engine/extractor provenance reference, artifact-relative path, artifact schema, small summary plus summary version | Library rows can load without reading NPZ arrays; preserve several configurations/builds per asset |
| `jobs` | Logical `job_id`, operation, immutable request/config JSON, location and expected identities, queue order, state, timestamps | Durable queue and recovery |
| `job_attempts` | `attempt_id`, job ID, session/worker identity, engine build, start/end state, receipt reference, error code/log reference | Ignore stale events, retain failed attempts, distinguish retry from previous execution |
| Catalog schema version | Application-controlled migration number, using `PRAGMA user_version` or equivalent | Upgrade safely from the first persistent release |

Initially show asset-based library rows after identification, with unverified discovery rows separately represented through locations. A separate stable `library_track_id` becomes worthwhile before annotations/playlists must survive retagging or alternate encodings; it is optional in the import/analyze/inspect slice. This reduces the prior catalog proposal while keeping locations and byte identity separate. If per-track notes enter the first release, add the logical track layer at that point. [Whole-file identity](../../src/setvector/ingestion/audio.py), [prior catalog proposal](../SetVector%20standalone%20analysis%20integration/integration_architecture.md)

Store the active catalog in local application data outside this OneDrive checkout and outside music folders. Start with a single database owner connection on a dedicated coordinator thread; pass view data to the UI. Worker processes publish artifacts and receipts only. Short explicit transactions and primary/foreign keys are enough initially. WAL is optional until there are concurrent database readers; enabling it is an implementation decision, not a scaling milestone by itself. If chosen, pin and verify the bundled SQLite runtime and preserve backup/checkpoint behavior. [SQLite WAL](https://sqlite.org/wal.html), [SQLite backup](https://docs.python.org/3.11/library/sqlite3.html#sqlite3.Connection.backup)

Useful indexes are locations by asset ID, analyses by asset/config, jobs by state/queue order, attempts by job ID, and ordinary library sort/search fields supported by measured UI needs. Do not add FTS, a generic event log, ORM, distributed jobs, vector search, waveform BLOBs, or playlist/annotation schemas to support basic import and inspection. This is a scope recommendation; collection size alone provides no benchmark proving such tools necessary. [Initial workflow and scaling policy](../../docs/architecture.md)

Do not use file mtime/size as proof of content identity; they are rescan hints. Do not rewrite a scientific asset's observed path on relink; update locations and pass the current audio path to the report service. Keep previews/reports disposable and separate from expensive scientific artifacts and durable user state. [Inspection](../../src/setvector/ingestion/audio.py), [report relink parameter](../../src/setvector/application/report.py)

### Gaps

- Search latency, import throughput and summary-cache size have not been measured. No numerical throughput or UI latency claim is established here.
- Path normalization, case sensitivity and removable-volume identity need target-OS fixtures. Blindly lowercasing all paths is not a complete location identity design.
- The exact logical-track policy for retagged/alternate-encoding files depends on whether first-release user annotations or playlists must survive those changes.

## Which seam and order minimize interference with analysis development?

### Takeaway

Create the desktop adapter and packaged worker as separate owned components, with the worker calling existing application services. Prove a single installed workflow first, then establish durable control/recovery, then expand inspection and measured throughput.

### Cited Findings

- Existing architecture directs clients through application services, leaves numerical/core modules free of UI dependencies, and explicitly advises ordinary functions before general plugin machinery. [Architecture](../../docs/architecture.md)
- The core package currently declares only the scientific dependencies; its wheel includes `src/setvector`. Qt, desktop state and protocol packages are not part of this packaging configuration. [Project configuration](../../pyproject.toml)
- The earlier research proposed the order packaged workflow → durable library → integrated inspection → measured scale. Its claims about API shape are consistent with the currently inspected code, while installed behavior remains untested. [Prior report](../../reports/SetVector%20standalone%20analysis%20integration.md), [analysis service](../../src/setvector/application/analyze.py)

### Inferences

Use an independently packaged desktop source area, for example `desktop/src/setvector_desktop/`, with `ui`, `coordinator`, `catalog`, `protocol`, and `worker` modules. This is a layout proposal, not a new plugin framework. The worker imports `setvector.application`, public domain/config types and `setvector.storage`; the GUI imports protocol DTOs and its own catalog. For packaging proof, pin a built core wheel from a known revision instead of consuming an analysis checkout that is changing underneath the desktop build. Keep imports of `baseline_identity`/specific numerical modules out of UI code. [Dependency direction](../../docs/architecture.md), [package layout](../../pyproject.toml)

| Order | Concrete deliverable | Why it precedes the next step | Exit evidence |
|---|---|---|---|
| 1 | One frozen worker plus one window opening a generated report | Finds bundled native-library, asset-path, codec and playback problems before broad UI work | On target Windows/macOS, without developer Python and offline: analyze fixture, report, preview, cache reuse |
| 2 | Minimal wrapper protocol plus fake-worker supervisor tests | Stable process outcomes are prerequisites for reliable durable jobs | Handshake mismatch, malformed output, exit/cancel races produce deterministic states |
| 3 | Catalog migrations, import/location identity, persistent queue and receipts | Recovery requires knowing what request was running and which result belongs to it | Restart/crash matrix preserves completed work, interrupted jobs and moved-file results |
| 4 | On-demand summaries, lightweight chart view and independent preview cache | Library selection exposes costs hidden by single-file report export | Switching tracks reuses scientific artifacts; missing audio still allows inspection |
| 5 | Corpus profiling and bounded optimization | Existing decode/preview paths hold whole audio; concurrency increases memory pressure | Measured startup, per-track RSS, cache latency and batch throughput on representative collections |

This order follows actual dependencies, rather than treating all features as equally parallel. The first UI slice is intentionally small; protocol state tests can start against a fake worker while packaging is being validated. Stage 3 should not begin adding lots of queue/UI behavior before state semantics in stage 2 are settled. [Current blocking service](../../src/setvector/application/analyze.py), [full-audio decode](../../src/setvector/ingestion/audio.py), [preview path](../../src/setvector/ingestion/preview.py)

The requested core changes should initially be limited to a written compatibility expectation around the three operations and their exception/result contracts. Later, stage callbacks, cooperative cancellation checkpoints, a prepared-analysis request API, or new feature schemas require explicit joint work with the engine owner. Adding a second decoder path or recomputing energy/BPM in the desktop would create conflicting scientific provenance; the adapter should use engine results and label absent capabilities. [Core module responsibilities](../../docs/architecture.md), [current measured fields](../../src/setvector/domain/bundle.py)

### Gaps

- Platform/release decisions, signing resources, supported maximum recording duration and memory budgets remain external prerequisites for promises about installed support. The adapter design can proceed experimentally; a supported release claim cannot.
- The proposed order was derived from inspected dependencies and documented platform behavior; it is an engineering recommendation, not comparative benchmark evidence that PySide6 is universally fastest or smallest.
