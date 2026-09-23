# Playlist Analysis Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend SetVector's offline analyzer and local workspace so a DJ can build a reviewable 1–3 hour set from a supplied crate or a 200–2,000-track library, then improve its suggestions with evaluated rhythm, harmony, structure, and energy evidence.

**Architecture:** Preserve the existing baseline-v1 feature artifact. Add versioned annotations, a local library index, pure source-region summaries, directional transitions, and timed planning before automatic analysis is required. Add separately cached rhythm, tonality, structure, and loudness families; admit each into automatic suggestions only after held-out evaluation. An ordered playlist, timed plan, and measured audio remain separate result types.

**Tech Stack:** Python 3.11+, NumPy, SciPy, librosa 0.11.0, SoundFile, soxr, JSON/NPZ artifacts, argparse, pytest, Ruff. Additional dependencies require an explicit offline, license, and clean-install check.

**Spec:** [Implementation Plan, Steps 4–10](../../implementation-plan.md#4-evaluation-collection-and-editable-annotations), [Architecture](../../architecture.md), [Extending Track Analysis for Playlist Planning](../../research/analysis-engine-extension.md), and [Playlist Engine Evaluation](../../research/playlist-engine-evaluation.md).

## Global constraints

- Analysis, review, planning, and reports work from local files without API keys, telemetry, hosted inference, or network calls after installation.
- Keep baseline-v1 artifacts readable and their IDs stable; never reinterpret the four current scalar series as loudness, tonal strength, or cross-track energy.
- Store estimates and human corrections separately. New identities include every effective config, source artifact, annotation revision, implementation/model revision, and calibration profile that can affect a result.
- Return unknown, unavailable, or review-needed states where evidence is weak. An algorithm score is not a calibrated probability without a calibration experiment.
- The first DJ result is an order with transition suggestions and a timed proposal; it does not render a mix. Listening flow follows with a separate scoring profile.
- Use source-relative seconds and explicit sample/window support. Handle silence, partial tails, variable tempo, changing key, and incomplete batches.
- Resolve supported OS/audio formats, metadata import, latency and memory budgets, initial cut/blend assumptions, and energy-arc input before a task depends on them. Until then, implementation can use files that the installed SoundFile backend decodes and report the actual supported matrix rather than promise formats.
- Save distributable tests as synthetic audio. Keep commercial evaluation audio outside Git unless redistribution is permitted.

## File map and dependency order

| Area | Existing seam | New responsibility |
|---|---|---|
| Baseline lookup | `src/setvector/storage/artifacts.py`, `application/analyze.py` | Read immutable v1 artifact by ID without source reinspection; keep existing `analyze_track` behavior. Coordinate with the [track-report plan](2026-09-22-interactive-track-report.md) to implement this once. |
| Annotation and catalog | `src/setvector/domain/`, `storage/`, `application/`, `cli/` | Validated revisions, mutable source paths/metadata, batch outcomes. |
| Region and DJ plan | New `analysis/regions.py`, `transitions/`, `playlists/` | Source-interval summaries, directional candidates, feasible placements, bounded search. |
| Rich measurements | New `domain/derived.py`, `storage/derived.py`, `analysis/rhythm.py`, `harmony.py`, `structure.py`, `loudness.py` | Independent typed events, matrices, intervals, identities, and codecs. |
| Energy | New `energy/` | Frozen fit profile, track scores, compatibility and provenance checks. |
| Evaluation | New local collection manifest, tests, and benchmark scripts under `tests/` and `tools/` | Technical and listening evidence, grouped splits, offline and resource checks. |

Implement Tasks 1–6 first for a usable reviewed-cue DJ workflow. Tasks 7–12 enrich the evidence without changing that workflow's contract. Each task should be a small local Conventional Commit after its own tests pass; do not push unless requested.

## Task 1: Stable baseline lookup and compatibility fixtures

**Files:** Modify `src/setvector/storage/artifacts.py`; add `tests/fixtures/baseline-v1/` and `tests/test_storage_lookup.py`; coordinate with `docs/superpowers/plans/2026-09-22-interactive-track-report.md`.

**Interface:** `ArtifactStore.load_stored(feature_id: str) -> tuple[AudioAsset, FeatureBundle]` loads by canonical ID and validates the asset and bundle without re-reading the original audio. `ArtifactStore.load(feature_id, expected_asset)` remains available.

- [ ] Write a fixture test that reads an artifact produced before the extension, including its original feature ID. A missing directory raises `InputError`, as specified by the track-report plan; corrupt or mismatched metadata raises `ArtifactError`.
- [ ] Run `python -m pytest tests/test_storage_artifacts.py tests/test_storage_lookup.py -q` and confirm the new lookup test fails for a missing method.
- [ ] Implement lookup through the existing strict v1 decoder and asset metadata check. Reject wrong schema, shape, hash, and unknown keys; do not relax `_SERIES` or the global `validate_version` helper.
- [ ] Re-run the focused tests and the existing `tests/test_application_analyze.py` cache tests. Commit as `feat(storage): load baseline artifacts by id` if the report work has not already landed.

## Task 2: Evaluation manifest and versioned annotations

**Files:** Create `src/setvector/domain/annotations.py`, `src/setvector/storage/annotations.py`, `src/setvector/application/annotations.py`, `tests/test_annotations.py`, `tests/test_annotation_storage.py`, and a documented example under `examples/`; extend `src/setvector/cli/__init__.py` only for a minimal import/inspect/correct workflow.

**Interface:** `AnnotationRecord(asset_id, kind, source_interval, value, provenance, reviewer_id, supersedes)`; `AnnotationRevision` has a content ID; `select_effective_annotations(asset_id, revision_id)` returns a validated view without altering raw estimates. Kinds include style/artist/remix metadata, tempo or beat correction, tonal candidate/correction, entry/exit cue, user energy rank or pairwise energy judgment, and transition judgment.

- [ ] Create tests for revision round-trip, deterministic ID, out-of-range or reversed cue rejection, duplicate/superseded records, missing reviewer provenance, and a correction leaving `FeatureBundle` bytes and ID unchanged.
- [ ] Run `python -m pytest tests/test_annotations.py tests/test_annotation_storage.py -q`; the new tests must fail before implementation.
- [ ] Implement immutable JSON revisions in a workspace `annotations/` area with atomic publication and strict field validation. Record an explicit `unknown` value where a reviewer cannot decide key, meter, or cue suitability. Keep user-editable files as imports; publish a new revision rather than overwriting one.
- [ ] Add a local evaluation manifest that references asset IDs and groups original/remix/edit families. Keep development and held-out groups disjoint and record the review protocol in [Playlist Engine Evaluation](../../research/playlist-engine-evaluation.md).
- [ ] Re-run tests and `python -m ruff check src tests`; commit as `feat(annotations): add reviewed analysis revisions`.

## Task 3: Sequential batch analysis and library index

**Files:** Create `src/setvector/domain/library.py`, `src/setvector/storage/library.py`, `src/setvector/application/library.py`, `tests/test_library_batch.py`, `tests/test_library_index.py`; extend `src/setvector/cli/__init__.py` with a batch command after its application API works.

**Interface:** `analyze_library(paths, config, store, catalog) -> BatchOutcome` calls existing `analyze_track`; `LibraryRecord` links current paths, asset ID, chosen baseline feature ID, user metadata, remix group, and status. Per-file results retain error type and cache status. Source paths and tags are mutable catalog data; `AudioAsset` and feature artifacts remain immutable.

- [ ] Write synthetic-file tests for two valid files plus one invalid file, duplicate content under different paths, restart/cache reuse, moved path, retagged file as a new asset ID, and Ctrl+C preserving completed artifacts. Verify a partial batch returns a nonzero CLI status with a machine-readable summary.
- [ ] Run `python -m pytest tests/test_library_batch.py tests/test_library_index.py tests/test_application_analyze.py -q` and confirm the new behavior is absent.
- [ ] Implement sequential, failure-isolated orchestration and an atomic local index. Start with a JSON manifest; benchmark enumeration and edits at 200 and 2,000 records before deciding whether SQLite is justified. Do not start process workers while whole-track decoding and copying dominate peak RAM.
- [ ] Add CLI progress on stderr and final JSON on stdout; keep input errors distinct from per-file processing errors. Run focused tests and a real 200-track benchmark on permitted local audio, recording elapsed time, peak RSS, and artifact size. Commit as `feat(library): index batch analysis results`.

## Task 4: Source-region summaries with coverage

**Files:** Create `src/setvector/analysis/regions.py`, `src/setvector/domain/regions.py`, and `tests/test_region_summaries.py`.

**Interface:** `summarize_region(bundle: FeatureBundle, start_seconds: float, end_seconds: float) -> RegionSummary`. The interval is `[start, end)` in source seconds; the result includes per-feature weighted summary, valid-support union in seconds, uncovered duration, invalid fraction, selected beat events, and source feature ID. A source interval must lie inside the associated asset duration at the application boundary.

- [ ] Write deterministic tests with overlapping feature windows, one invalid ratio, valid zero-amplitude silence, a region partly inside the omitted tail, exact endpoint behavior, and a region with no valid measurements. Verify union coverage never exceeds interval length.
- [ ] Run `python -m pytest tests/test_region_summaries.py -q` and confirm failure.
- [ ] Implement window-intersection weighting and clipped union coverage. Do not divide by a count of intersecting frames; return missing with a reason when no valid support exists. Keep the function pure and independent of catalog or CLI.
- [ ] Run focused tests plus `tests/test_domain_features.py`; commit as `feat(analysis): summarize source regions`.

## Task 5: Directional transitions and feasible timed placements

**Files:** Create `src/setvector/domain/transitions.py`, `src/setvector/transitions/compare.py`, `src/setvector/domain/playlist.py`, `src/setvector/playlists/timeline.py`, `tests/test_transitions.py`, and `tests/test_timeline.py`.

**Interfaces:** `compare_transition(exit: RegionSummary, entry: RegionSummary, assumptions: TransitionAssumptions, reviewed: EffectiveAnnotations) -> TransitionEvidence` records cut or short-blend type, source cues, playback rates, overlap, key-lock/beat/gain/EQ assumptions, measured components, and unknown reasons. `build_timed_plan(occurrences, transitions) -> TimedSetPlan` checks source bounds and middle-track entry-before-exit, then derives set time from played spans, rates, gaps, and overlaps. Keep `TransitionEvidence` separate from scored utility.

- [ ] Write tests where A→B differs from B→A, a cue correction changes evidence, unknown beat/key yields review-needed rather than a fabricated value, and a cut is available when a blend is unsupported.
- [ ] Add timeline tests for repeated asset IDs with distinct occurrence IDs, middle-track cue conflict, playback rate, trims, overlap and gap accounting, and source bounds.
- [ ] Run `python -m pytest tests/test_transitions.py tests/test_timeline.py -q` and confirm failure.
- [ ] Implement contracts and pure numerical logic using reviewed cues and Task 4 summaries. Keep claimed phrase/downbeat alignment `unknown` without evidence. Run focused tests and commit as `feat(transitions): model reviewed cues and timed placements`.

## Task 6: Reviewed-cue DJ planner and two selection policies

**Files:** Create `src/setvector/domain/planning.py`, `src/setvector/playlists/search.py`, `src/setvector/application/plan.py`, `tests/test_planner_constraints.py`, `tests/test_planner_search.py`, and `tests/test_planner_integration.py`; add a thin `plan` CLI handler.

**Interfaces:** `PlanRequest` includes `mode`, `selection_policy`, candidates, required/excluded IDs, anchors, count or duration bounds, repeat policy, maximum tempo change, missing-evidence policy, track preferences, and versioned score configuration. `plan_set(request, catalog, annotations, store) -> PlanResult` returns distinct feasible timed plans, edge explanations, warning flags, elapsed duration, provenance, and `best_found_within_budget` status.

- [ ] Write hard-constraint tests for contradictory requirements, required tracks, exclusions, endpoint anchors, duplicate policy, valid cue routing, and empty/trivial pool prevention. Distinguish invalid request, proved small-instance infeasibility, and budget-exhausted no-plan.
- [ ] Write small exact-instance tests for the deterministic objective and a greedy baseline. Test directional edge updates after insertion/swap and replacement moves; compare bounded search to exact results where possible.
- [ ] Run `python -m pytest tests/test_planner_constraints.py tests/test_planner_search.py tests/test_planner_integration.py -q` and confirm the missing interfaces fail.
- [ ] Implement a declared objective: inclusion preference plus directional transition utility, minus elapsed-time arc deviation and repetition/sameness penalties. Persist component scales, weights, missing-evidence policy, tie-break order, and search seed. Use a versioned user energy rank or explicit ordinal arc for the early experiment; do not use the current normalized onset or RMS as calibrated cross-track energy.
- [ ] Implement fixed-crate greedy sequencing first, then bounded multi-start beam search with swap/insertion repair, followed by pool replacement moves. Track current entry cue and elapsed planned time; preserve mandatory and varied candidates during pruning. Return alternatives and worst-edge warnings.
- [ ] Test both policies on representative 1–3 hour requests and benchmark 200–2,000 candidate libraries against the agreed latency/RAM budget. Compare to random, BPM sort, and Camelot-only baselines when those labels exist. Commit as `feat(playlists): plan reviewed DJ sets`.

## Task 7: Versioned derived-analysis artifact foundation

**Files:** Create `src/setvector/domain/derived.py`, `src/setvector/storage/derived.py`, `src/setvector/analysis/derived_identity.py`, `tests/test_derived_contracts.py`, and `tests/test_derived_storage.py`; leave `domain/bundle.py` and the v1 codec's accepted schema unchanged.

**Interfaces:** A `DerivedIdentity` identifies family, schema/algorithm revision, effective parameters, dependency versions, source asset/artifact IDs, implementation digest, and optional model-weight digest. Typed `TimedEvent`, `TimedInterval`, and `FeatureMatrix` each carry source-relative time, validity or unknown reason, units/labels, and strict dimensions. `DerivedStore.save/load` publishes a family artifact by ID.

- [ ] Test independent time grids, 12×T chroma with labels, events between baseline frame centers, intervals within asset duration, missing values, immutable round-trip, and old v1 fixture readability.
- [ ] Test corruption, unexpected fields/NPZ keys, object arrays, nonfinite values, version mismatch, incomplete directory, and simultaneous identical publication. A changed config, code digest, source ID, or model hash must produce a new derived ID.
- [ ] Run `python -m pytest tests/test_derived_contracts.py tests/test_derived_storage.py tests/test_storage_artifacts.py -q` and confirm new failures before coding.
- [ ] Implement family-specific schema dispatch and atomic JSON/NPZ publication. Record code digest for the actual local algorithm inputs and weight digest for an optional model. Use `np.load(..., allow_pickle=False)`; avoid loosening baseline validation. Run focused tests and commit as `feat(analysis): add versioned derived artifacts`.

## Task 8: Rhythm alternatives and reviewed downbeat anchors

**Files:** Create `src/setvector/analysis/rhythm.py`, `src/setvector/application/enrich.py`, `tests/test_rhythm.py`, and `tests/test_rhythm_enrichment.py`; use Task 7 storage.

**Interface:** `analyze_rhythm(baseline: FeatureBundle, config: RhythmConfig) -> RhythmEvidence` returns BPM hypotheses including half/double candidates, local tempo estimates, beat-event alternatives, stability diagnostics, and explicit downbeat/meter `unknown` unless reviewed or separately estimated. An enrichment request selects families and reuses unchanged family artifacts.

- [ ] Write click-track and variable-tempo tests covering half/double ambiguity, beat drift, silent or short tracks, and events between baseline frame timestamps. Include a human-corrected downbeat anchor without changing raw rhythm output.
- [ ] Run `python -m pytest tests/test_rhythm.py tests/test_rhythm_enrichment.py -q` and confirm failure.
- [ ] Reuse baseline onset only where its within-track scaling is appropriate; compute local tempogram/candidate peaks in bounded windows. Save diagnostic strengths as diagnostics, not probabilities. Use explicit timing conversion and no assumed 4/4 phase.
- [ ] Compare local and global tempo/beat results to held-out reviewed grids, including first seconds and proposed transition windows. Record beat, downbeat, continuity, and abstention metrics by style. Keep any optional learned downbeat backend behind a locally supplied checkpoint and separate identity. Run tests and commit as `feat(analysis): add rhythm alternatives`.

## Task 9: Local chroma, tonal candidates, and Camelot display

**Files:** Create `src/setvector/analysis/harmony.py`, `src/setvector/domain/tonality.py`, `tests/test_harmony.py`, and `tests/test_camelot.py`; add a derived-artifact encoder for the 12×T matrix.

**Interface:** `analyze_tonality(decoded: DecodedAudio, config: TonalityConfig) -> TonalityEvidence` returns timed chroma, tuning/configuration, ranked local tonic/mode candidates, diagnostic margin, and `unknown/other` support. `camelot_code(tonic, mode) -> str | None` maps only supported major/minor labels; transition scoring uses local overlap evidence and pitch/key-lock assumptions.

- [ ] Test matrix dimensions and true frame times, known synthetic tonal examples, silence and percussion-heavy ambiguity, a changing-key example, all 24 major/minor Camelot mappings, and unknown/modal input returning no code.
- [ ] Run `python -m pytest tests/test_harmony.py tests/test_camelot.py -q` and confirm failure.
- [ ] Compute declared CQT chroma on a bounded-resolution audio path; compare raw versus harmonic-emphasized input on the development set. Rank 24 templates in declared windows, preserve top alternatives, and abstain on weak or ambiguous evidence. Never label template margin a calibrated probability.
- [ ] Evaluate exact key, relative/parallel/fifth errors, and abstention coverage on held-out tonal regions by style and remix family. Test overlap-local key versus global key in reviewed transitions. Run tests and commit as `feat(analysis): add local tonal evidence`.

## Task 10: Section boundaries and cue candidates

**Files:** Create `src/setvector/analysis/structure.py`, `src/setvector/transitions/cues.py`, `tests/test_structure.py`, and `tests/test_cue_candidates.py`.

**Interface:** `detect_boundaries(rhythm, tonality, baseline, config) -> StructureEvidence` returns timed candidate boundaries and supporting novelty. `rank_cues(structure, regions, annotations, request) -> tuple[CueCandidate, ...]` returns bounded entry/exit alternatives with evidence and review state, never a verified phrase or drop solely from a segmenter.

- [ ] Write fixtures for repeated sections, a boundary inside silence, no stable pulse, a vocal annotation over an otherwise promising overlap, and a middle-track cue pair that leaves too little played time. Verify top candidates are within source bounds and have explicit unknowns.
- [ ] Run `python -m pytest tests/test_structure.py tests/test_cue_candidates.py -q` and confirm failure.
- [ ] Implement a low-resolution novelty/boundary baseline from chroma/rhythm/timbre changes; cap or sparsify any recurrence computation. Rank cues using reviewed beat/downbeat anchors where available, source-region coverage, pulse stability, and allowed overlap. Keep vocal presence manual until a detector is separately validated.
- [ ] Report boundary metrics and blind top-cue acceptance by style and transition type; compare with simple fixed-position/beat baselines. Run tests and commit as `feat(analysis): propose section and cue candidates`.

## Task 11: Loudness, dynamics, and frozen energy calibration

**Files:** Create `src/setvector/analysis/loudness.py`, `src/setvector/energy/calibration.py`, `src/setvector/energy/score.py`, `src/setvector/domain/energy.py`, `tests/test_loudness.py`, `tests/test_energy_calibration.py`, and `tests/test_energy_cache.py`.

**Interfaces:** `analyze_loudness(decoded_preserving_channels, config) -> LoudnessEvidence` records meter revision, channel policy, integrated and valid local loudness, dynamics, and silence/gating state. `fit_profile(training_manifest, feature_ids, judgments, config) -> CalibrationProfile` freezes population and transforms. `score_track(evidence, profile, model) -> EnergyResult` reports contributions, validity, and comparability IDs.

- [ ] Write reference-signal tests for level, stereo/mono difference, silence, gating, and declared local-window support. Do not call independently gated short clips momentary loudness; use the selected meter's proper window definition. Verify a pinned third-party meter, if chosen, against reference material and its exact standard revision.
- [ ] Write cache tests: changing model weights reuses raw features; changing a loudness extractor invalidates only dependents; a new calibration population/profile changes energy IDs; incompatible profiles cannot be silently compared; missing inputs do not trigger implicit per-track reweighting.
- [ ] Run `python -m pytest tests/test_loudness.py tests/test_energy_calibration.py tests/test_energy_cache.py -q` and confirm failure.
- [ ] Decode with original level and preserved channels for loudness. Keep the existing baseline RMS and normalized onset semantics unchanged. Add a separately identified unnormalized rhythmic-density measurement if pilot judgments support it. Fit a small interpretable model on development tracks, with explicit reduced-feature variants and smoothing.
- [ ] Compare held-out pairwise energy rankings and within-track landmarks against loudness-only and tempo-only baselines; report feature ablations, ties, disagreement, and style slices. Set an acceptance rule from the pilot before enabling automatic arcs. Run tests and commit as `feat(energy): calibrate cross-track energy`.

## Task 12: Automatic suggestion gates, offline integration, and planner handoff

**Files:** Modify `src/setvector/application/plan.py` and `src/setvector/cli/__init__.py`; create `tests/test_automatic_suggestions.py`, `tests/test_offline_planner.py`, and a benchmark script under `tools/`; update `README.md`, `docs/implementation-plan.md`, and `docs/research/playlist-engine-evaluation.md` with measured results.

**Interface:** A planning request selects `reviewed_only` or a named evaluated automatic suggestion profile. Each suggested cue/transition records which evidence families and acceptance gates it used; changing an annotation, family artifact, or calibration result recomputes only affected downstream results. Listening-flow mode can reuse candidate IDs and search but requires its own scoring profile and ordinary playback timing.

- [ ] Test that weak key/beat/phrase evidence yields `review_needed` or a cut, never a claimed seamless blend; a corrected cue recomputes whole-route feasibility and duration. Test a high-quality family being enabled only by its saved evaluation profile.
- [ ] Extend `tests/test_offline_analysis.py` to block socket connections during batch, enrichment, calibration, and planning. Include a source path with spaces/Unicode and missing optional model weights; core reviewed-cue planning must still work.
- [ ] Run `python -m pytest -q`, `python -m ruff check src tests`, and `python -m ruff format --check src tests`. Run installed-package CLI smoke tests and record elapsed time, peak RSS, artifact size, and cache-hit speed for 200 and 2,000 tracks on the target machine.
- [ ] Run blind transition and whole-sequence comparisons against random, BPM-sort, Camelot-only, greedy, and human-prepared references under the same pool and constraints. Publish observed failure slices and abstention; do not describe untested weights as optimal.
- [ ] Update the high-level plan with measured outcomes and remaining format/OS/performance decisions. Commit as `docs(plan): record playlist analysis validation` (and a separate `feat` commit for executable integration changes).
