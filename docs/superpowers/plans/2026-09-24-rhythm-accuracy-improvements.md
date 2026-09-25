# Rhythm Accuracy Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve beat timing and downbeat phase with measurable gains on manually verified audio while keeping unreliable grids out of downstream reports.

**Architecture:** Keep the existing offline Beat This! detector, baseline tracker, grid fitter, and content-addressed rhythm artifact. Add a separate evaluator first, then make small versioned changes to candidate selection, timing, and bar phase. Only enable each change after it passes frozen gold-set gates.

**Tech Stack:** Python 3.11+, NumPy, SciPy, pytest, existing SetVector CLI and rhythm artifact format.

**Spec:** `docs/superpowers/specs/2026-09-24-rhythm-accuracy-improvements.md`

## Global Constraints

- Core analysis runs locally after dependencies are installed, without API keys, cloud services, telemetry, GPT, or network access.
- Do not add an automatic model download path; keep Beat This! weights hash verification.
- Preserve the source of every selected grid and make uncertainty visible in the rhythm artifact and report.
- Version algorithm and schema changes so old artifacts are not silently reused.
- The 40-song gold holdout is frozen and concealed before tuning; Rekordbox is a diagnostic pseudo-reference.
- Keep the reference collection and its local paths on the local reference branch unless the user separately requests publication.

## Review Focus

- Duplicate detected beats must not match one gold beat twice; Task 1 tests one-to-one matching.
- A missing or silent passage must not be counted as a detector failure when the annotation marks it ambiguous; Task 1 tests exclusion masks.
- A steady grid with a two-beat bar offset must have high beat F1 and low downbeat F1; Task 1 tests independent metrics.
- Beat This! beats with uncertain bar phase must remain usable as beats; Task 2 tests partial reliability.
- A segment boundary must neither duplicate nor skip a grid beat; Task 3 tests continuity.

## File map and interfaces

| File | Responsibility |
|---|---|
| `src/setvector/evaluation/rhythm.py` | Pure matching, masks, per-track scores, and family aggregation. No inference or Rekordbox-specific code. |
| `scripts/evaluate_rhythm.py` | Read local annotation JSON, rhythm artifacts, and optional Rekordbox comparison; write JSON/CSV summaries. |
| `tests/test_evaluation_rhythm.py` | Matching and metric edge cases. |
| `src/setvector/analysis/rhythm.py` | Candidate quality, selection, and bar-phase assignment. |
| `src/setvector/analysis/grid.py` | Beat-grid fit and segment continuity. |
| `src/setvector/analysis/beat_this/__init__.py` | Retain downbeat evidence needed by a phase decoder without changing model weights. |
| `src/setvector/analysis/phase.py` | Score bar-phase paths against downbeat evidence and represent uncertain spans. |
| `src/setvector/domain/rhythm.py` | Validate any new partial bar-position contract. |
| `src/setvector/analysis/identity.py` | Bump rhythm algorithm version and record parameters for changed output. |
| `tests/test_analysis_rhythm.py`, `tests/test_analysis_grid.py`, `tests/test_domain_rhythm.py`, `tests/test_offline_analysis.py`, `tests/test_visualization_model.py` | Regression and offline integration. |

The evaluator's annotation input is a local JSON document with a `tracks` array. Each entry has `asset_id`, `family_id`, `duration_seconds`, `beat_times`, `downbeat_times`, and `excluded_intervals` (`[start_seconds, end_seconds]` pairs); optional `tempo_changes` and `meter_changes` are chronological arrays. `asset_id` is the SetVector asset identifier; `family_id` groups edits and duplicates for splits and confidence intervals. The evaluator output includes counts, precision, recall, and F1 at 40 and 80 ms per track, aggregate metrics by family, source and cohort, and coverage over all 150 songs. This schema is deliberately independent of either detector's output.

### Task 1: Freeze annotations and build the offline evaluator

**Files:** Create `src/setvector/evaluation/rhythm.py`, `scripts/evaluate_rhythm.py`, and `tests/test_evaluation_rhythm.py`; add local annotation instructions in `docs/rhythm-evaluation.md`.

**Interfaces:** `match_events(reference: Sequence[float], predicted: Sequence[float], tolerance: float, excluded_intervals: Sequence[tuple[float, float]] = ()) -> MatchCounts`; `score_track(annotation: Mapping[str, object], rhythm: RhythmAnalysis) -> TrackScore`. The CLI reads annotations and rhythm artifacts, never audio.

- [ ] **Step 1: Freeze the split.** Assign 40 gold songs (30 stratified plus 10 challenge), 24 development songs, and the remaining songs to pseudo-label regression. Group all edits and duplicate asset IDs under one `family_id`. Record the selected IDs and annotation rules in `docs/rhythm-evaluation.md` before examining any candidate change.
- [ ] **Step 2: Add failing evaluator tests.** Pin `match_events([0.0, 0.5], [0.001, 0.002, 0.5], 0.04)` to two matches and one false positive; pin an excluded interval around an ambiguous beat so it affects neither numerator nor denominator. Assert that beats `[0, .5, 1, 1.5]` with downbeats `[1]` score perfectly for beats but fail against gold downbeats `[0]`.

  ```python
  counts = match_events([0.0, 0.5], [0.001, 0.002, 0.5], 0.04)
  assert (counts.matched, counts.false_positive, counts.false_negative) == (2, 1, 0)
  assert match_events([0.0], [0.0], 0.04, [(0.0, 0.1)]).matched == 0
  ```
- [ ] **Step 3: Implement chronological one-to-one matching and track/family aggregation.** Use monotonically advancing indices, finite sorted inputs, and separate beat and downbeat calls. Return precision, recall, F1, raw counts, coverage, and abstention; calculate confidence intervals by resampling `family_id`, never individual events.
- [ ] **Step 4: Annotate the frozen material.** For each song label four 16–32-bar windows; label 12 full songs including variable tempo, fallback shifts, and long downbeat-phase changes. Blind the first pass to both machine grids; independently label at least 20%, adjudicate disagreements, and record excluded silence or ambiguity. Keep annotation JSON local if it contains user-specific paths.
- [ ] **Step 5: Run `python -m pytest tests/test_evaluation_rhythm.py -v` and the evaluator on the unchanged engine.** Save development and XML pseudo-label baselines. Keep gold annotations concealed until Task 5. Commit evaluator code and documentation with `test(rhythm): add offline gold-set evaluation`.

### Task 2: Separate beat reliability from bar reliability and measure both candidates

**Files:** Modify `src/setvector/analysis/rhythm.py`, `src/setvector/domain/rhythm.py`, `src/setvector/analysis/identity.py`, and `tests/test_analysis_rhythm.py`; extend `tests/test_domain_rhythm.py`.

**Interfaces:** `_evaluate` retains independent beat and bar rejection reasons. `extract_rhythm` evaluates both Beat This! and fallback on every song and selects one beat grid using calibrated evidence; Beat This! can be selected with unknown bar positions. The artifact keeps source and both candidate qualities.

- [ ] **Step 1: Add failing tests.** A synthetic Beat This! candidate with 128 steady beats and irregular downbeats must retain its reliable beat grid with null bar positions. Both candidates must appear in `quality`; a fallback with high grid fit but off-beat phase must not silently replace an accurate Beat This! candidate. Keep a test for both candidates failing and `source == "none"`.
- [ ] **Step 2: Split the decision.** Assess beat count, interval CV, and grid fit independently of modal bar length and bar regularity. Evaluate baseline beats even when Beat This! passes. Use development annotations to calibrate selection; retain Beat This! as the tie choice when evidence is equal. Record rejection reasons per component.
- [ ] **Step 3: Version the changed output.** Bump `RHYTHM_ALGORITHM_VERSION` and record selection parameters in `RHYTHM_PARAMETERS`. Keep the existing `RhythmAnalysis` serialization valid for fully unknown bars; only change schema if Task 4 introduces partial unknown spans.
- [ ] **Step 4: Run `python -m pytest tests/test_analysis_rhythm.py tests/test_domain_rhythm.py tests/test_offline_analysis.py -v`.** Compare unchanged-engine and candidate outputs on development annotations and XML diagnostics. Retain the change for final validation only if beat F1 improves without more false-reliable grids; otherwise keep the measured candidate logic in an experiment branch. Commit the candidate with `fix(rhythm): separate beat and bar reliability`.

### Task 3: Diagnose timing offsets and grid boundaries

**Files:** Modify `src/setvector/analysis/grid.py` and `src/setvector/analysis/rhythm.py`; extend `tests/test_analysis_grid.py` and `tests/test_analysis_rhythm.py`.

**Interfaces:** Grid fitting still returns `GridFit` with contiguous ordered `Segment`s and a generated beat sequence. Any offset estimate is bounded to ±120 ms and is accepted only when supported by local audio or gold annotations; the evaluation command reports unshifted and best-offset scores separately.

- [ ] **Step 1: Add failing synthetic cases.** A constant 42 ms detector offset must report poor raw ±40 ms agreement and high best-offset diagnostic agreement. A phase jump at a segment boundary must be detectable without changing the true tempo. Assert strictly increasing grid times and no duplicate or skipped beat across adjacent segments.
- [ ] **Step 2: Analyze the development cohort.** Report raw detections, fitted-grid beats, signed nearest-gold residuals over time, and per-segment residuals for all 22 fallback disagreements. Check half/double tempo separately for the two Beat This! outliers. Listen to examples before selecting a timing target.
- [ ] **Step 3: Implement the smallest supported correction.** Start with a bounded global alignment when residuals have stable sign and low spread. Add segment-aware correction only for tracks where gold labels show a real local shift. Preserve segment continuity and leave a grid untouched if the evidence is ambiguous. Do not tune against Rekordbox alone.
- [ ] **Step 4: Run `python -m pytest tests/test_analysis_grid.py tests/test_analysis_rhythm.py -v` and compare development and XML cohorts.** Require at least a five-point beat F1 gain on targeted development failures, no development macro beat F1 loss, and no increase in false-reliable grids before carrying the correction into Task 5. Commit a candidate correction with `fix(rhythm): improve beat-grid timing`; otherwise record the rejected experiment in `docs/rhythm-evaluation.md`.

### Task 4: Decode downbeat phase from evidence across sections

**Files:** Create `src/setvector/analysis/phase.py`; modify `src/setvector/analysis/beat_this/__init__.py`, `src/setvector/analysis/rhythm.py`, `src/setvector/domain/rhythm.py`, and `src/setvector/analysis/identity.py`; extend `tests/test_analysis_rhythm.py` and `tests/test_domain_rhythm.py`.

**Interfaces:** `decode_bar_positions(beat_times: np.ndarray, downbeat_evidence: np.ndarray, meter: int) -> tuple[int | None, ...]`. Evidence is sampled at beat times from Beat This! downbeat logits; its timestamp origin and 50 Hz frame rate are explicit. The decoder penalizes phase changes and can emit unknown positions for ambiguous spans.

- [ ] **Step 1: Verify the failure labels.** Listen to the seven persistent two-beat shifts and a sample of the 18 alternating phase tracks; mark whether SetVector, Rekordbox, or both are uncertain in the development annotations. Keep these labels distinct from the frozen holdout.
- [ ] **Step 2: Add failing decoder tests.** Pin a clean four-beat phase, one stray downbeat peak that must not flip phase, a sustained two-beat shift that should change phase once, an ambiguous silent section that yields null positions, and exact four-beat continuity across a grid-segment boundary.
- [ ] **Step 3: Implement a phase path over beat indices.** Score each phase using downbeat logits at the corresponding grid beats, penalize transitions, and choose unknown when the best and next-best phases are too close. Validate downbeat-logit alignment and any peak-time refinement separately on development audio. Keep all beat times unchanged in this task.
- [ ] **Step 4: Update the artifact contract only if partial unknown spans are emitted.** Validate that known positions advance modulo meter, unknown positions contain no fabricated downbeats, and `GridSegment.first_bar_position` matches the first beat of its segment when known. Bump schema and algorithm identity; ensure old artifacts are readable or clearly invalidated.
- [ ] **Step 5: Run `python -m pytest tests/test_analysis_rhythm.py tests/test_domain_rhythm.py tests/test_offline_analysis.py tests/test_visualization_model.py -v`.** Require a ten-point downbeat F1 or phase-accuracy gain on the development challenge cohort without beat F1 regression or more false-reliable bars. Commit a candidate decoder with `fix(rhythm): stabilize downbeat phase`; otherwise record the experiment result.

### Task 5: Evaluate confidence-gated fallback bars and release

**Files:** Modify `src/setvector/analysis/rhythm.py`, `src/setvector/domain/rhythm.py`, `src/setvector/analysis/identity.py`, `README.md`, and `docs/architecture.md`; extend `tests/test_analysis_rhythm.py`, `tests/test_domain_rhythm.py`, `tests/test_offline_analysis.py`, and `tests/test_visualization_model.py`.

**Interfaces:** Fallback remains a source of beat times; its bar positions are either evidence-backed or null. A source-specific bar confidence and reason are exposed in the artifact and report. All changes remain offline and content-addressed.

- [ ] **Step 1: Add failing tests.** A synthetic fallback beat grid with clear four-beat evidence may receive bar positions; the same beats with ambiguous or silent evidence must keep null bar positions. An acapella with erratic spacing must remain an abstention, and cached artifacts from the old algorithm must not be reused as new ones.
- [ ] **Step 2: Measure bar evidence on the development set.** Reuse the phase decoder only if its confidence calibrates on fallback tracks; otherwise preserve the current fallback no-bars behavior and document that result. Do not infer bars from beat count modulo four alone.
- [ ] **Step 3: Run the frozen holdout once after decisions are fixed.** Score the unchanged engine and final candidate together, then report beat and downbeat macro F1 at 40 ms, 80 ms diagnostics, bar-phase runs, source/coverage, false-reliable cases, and bootstrap intervals by edit family. Include all 150 songs in coverage and separate the 30 samples and five missing files. Ship only if representative beat F1 does not fall, targeted beat failures gain five points where relevant, downbeat challenges gain ten points where relevant, and coverage and false-reliable counts do not worsen. A failure returns the candidate to development and requires a fresh holdout for another release decision.
- [ ] **Step 4: Run full project checks:** `python -m pytest`, `python -m ruff check .`, and a disconnected offline analysis/report smoke test with bundled weights. Compare CPU runtime and peak memory with the baseline. Update README and architecture only with measured behavior; commit with `docs(rhythm): document validated accuracy changes`.

## Ordering and stop rules

Finish Task 1 before tuning. Tasks 2–4 can each be rejected on development results; only Task 5 reads the frozen holdout. Do not turn the ±80 ms diagnostic or a best-offset score into the headline metric. Publish broader-genre accuracy claims only after a separate, diverse holdout exists.
