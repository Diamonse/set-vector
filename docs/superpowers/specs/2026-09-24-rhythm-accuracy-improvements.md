# Rhythm accuracy improvements

## Goal

Improve SetVector's beat timing and bar phase on the user's collection while preserving truthful abstention when evidence is weak. Measure improvement against manually checked audio, using Rekordbox as a diagnostic comparison rather than a definitive label.

## Evidence from the reference collection

The [comparison snapshot](../../../reports/rekordbox-reference/README.md) has 150 song records representing 148 unique audio assets, 30 short samples, and five missing locations. Ninety-eight songs selected Beat This!, 44 selected the fallback beat grid, and eight had no reliable grid. At ±40 ms, 107 of 142 songs with a grid had at least 95% beat precision and Rekordbox coverage; at ±80 ms, 118 did. Thirty-millisecond changes in the tolerance are therefore material and need separate reporting.

Twenty-two of 44 fallback song grids remain below 95% agreement at ±80 ms. Twenty of these have beat counts within 2% of Rekordbox; 16 single-marker tracks have tempo differences below 0.1 BPM. This points to local timing and phase errors rather than a simple tempo multiplier on most of the cohort. Two Beat This! tracks have likely half/double-tempo disagreements. Twenty-six Beat This! songs have good beats at ±80 ms but poor downbeats; seven appear about two beats out of phase for nearly the whole song, and others alternate long phase sections. Some of these may be Rekordbox errors and require listening.

Three of the eight song abstentions are variable-grid acapellas. The collection is concentrated in Tech House (86 of 150 songs), so success on it cannot establish broad genre accuracy.

## Evaluation contract

Create a fixed 40-song gold holdout before tuning: 30 stratified by genre, tempo, source, and single versus multiple Rekordbox markers, plus 10 challenge cases from the observed failures. Select 24 other songs for development. Keep alternate edits, remixes, and duplicate assets in one split. The remaining XML records provide a pseudo-label regression set, not a source of gold labels.

Annotate beat times, downbeats/bar one, tempo and meter changes, and ambiguous or silent intervals. Use four 16–32-bar windows per song (intro, stable middle, transition, outro); annotate 12 whole tracks including variable tempo and long phase changes. Annotate blind to both grids on first pass; double annotate at least 20% of the material and adjudicate disagreement. Preserve local file identifiers and annotation provenance without copying audio into Git.

Primary scores are chronological one-to-one beat and downbeat precision, recall, and F1 at ±40 ms, macro averaged by track and edit family. Include ±80 ms and best global offset within ±120 ms as diagnostics. Report bar phase modulo meter, longest wrong-phase run, first-to-last drift, variable-tempo boundary error, source selection, grid coverage, abstention, and false-reliable grids. Include all 150 songs in coverage denominators; samples and missing audio form separate cohorts. Bootstrap confidence intervals over edit families, not individual beats.

Freeze and conceal the gold holdout before tuning. Tune and select methods only with development annotations and XML diagnostics. Run the unchanged engine and the final candidate on the frozen holdout together once decisions are fixed. A candidate change is eligible to ship when representative holdout macro beat F1 does not fall, the targeted beat-failure cohort improves by at least five percentage points where relevant, the downbeat challenge cohort improves by at least ten percentage points where relevant, and false-reliable grids and overall coverage do not worsen. Compare runtime and memory with the current engine. If a proposed method fails a gate, preserve its experiment result and do not enable it; a new validation cycle needs a fresh holdout. These are provisional project gates; no accuracy claim should rely on Rekordbox alone.

## Implementation sequence

1. **Reproducible evaluator.** Add a read-only, offline evaluation command that ingests frozen annotations, SetVector rhythm artifacts, and optionally Rekordbox XML. It must report the same definitions and denominators for every experiment and keep annotation data independent of engine output. Validate matching with small synthetic fixtures that expose duplicate beats, missing beats, shifted phases, and abstention.
2. **Candidate diagnosis and selection.** Run both Beat This! and fallback on the development set, independently score beat stability and bar evidence, and quantify when selecting the fallback would help. A reliable Beat This! beat grid must not be discarded solely because bar phase is uncertain. Selection may change only after gold-set calibration and regression checks. Keep source and reasons inspectable.
3. **Beat timing and grid segments.** Test a bounded global timing adjustment, then segment-aware timing correction and continuity checks where one offset cannot explain the track. Assess raw detections and fitted grid separately; reject any correction that reduces gold accuracy. Do not assume a low-frequency onset peak represents the true beat: the original design found a flat sidechained bass profile on the initial club tracks. Detect possible half/double tempo and genuine variable tempo separately from timing shifts.
4. **Downbeat phase.** Use Beat This! downbeat evidence along grid beats to score candidate bar phases, with a penalty for phase changes and an explicit uncertain state. Refine downbeat peak times only if evaluation supports it. Confirm long two-beat shifts by listening before tuning, since Rekordbox can also be wrong. Represent unknown bar phase without inventing downbeats; this may require relaxing the current all-known-or-all-unknown artifact rule with a versioned schema change.
5. **Fallback bars and release gate.** Experiment with confidence-gated bar phase for fallback grids after the Beat This! phase work. Preserve null bar positions when confidence is insufficient. Update extractor identity and artifact validation with any selection or bar schema change, run offline integration and report tests, then reevaluate the frozen holdout without retuning.

## Constraints

- Core analysis runs locally after dependencies are installed, without API keys, cloud services, telemetry, GPT, or network access.
- Do not add an automatic model download path; keep Beat This! weights hash verification.
- Preserve the source of every selected grid and make uncertainty visible in the rhythm artifact and report.
- Version algorithm and schema changes so old artifacts are not silently reused.
- Keep the reference collection and its local paths on the local reference branch unless the user separately requests publication.

## Decision points

The current collection can prioritize experiments but cannot decide whether a 40 ms constant offset or a two-beat phase shift is SetVector's error. Listening and frozen annotations decide that. A decoder, offset correction, or fallback bar estimator may remain experimental if it fails the gold gate. A broader genre holdout is needed before claiming the engine is generally accurate.
