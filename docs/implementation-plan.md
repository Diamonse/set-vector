# Implementation Plan

Build an offline Python library and CLI with interactive reports, then a DJ preparation planner and a listening-flow mode. The planner must distinguish an ordered playlist from a timed set proposal and from measured mixed audio. Follow the [architecture](architecture.md) for module and artifact boundaries and the [playlist research](research/playlist-creation-engine.md) for the evidence behind sequencing choices.

## 0. Release scope

The first planning workflow targets a local library of about 200–2,000 tracks and 1–3 hour sets across House, Hip-hop, Pop, EDM, BollyHouse, and Bollywood. DJ preparation comes first: produce an order with reviewable transition suggestions, not a rendered mix. The planner must eventually support both reordering a supplied crate and selecting tracks from a larger library. Manually confirmed cues and keys are acceptable while automatic analysis improves. A later listening-flow mode shares the planning engine but uses ordinary track playback and a different scoring profile.

Before implementation depends on them, settle supported operating systems and audio formats, a planning latency and memory budget, the initial cut/blend types, metadata input, and how users specify a target energy arc. Use these decisions to choose fixtures, library benchmarks, and support guarantees. Core use must work without network access after dependencies are installed.

## 1. Package and data contracts

Create a tested Python environment, `pyproject.toml`, and `src/setvector/`. Add configuration and core result types, a CLI entry point, and development checks. Select compatible dependency versions through an actual clean install.

Done when the built package installs into a fresh environment, the CLI shows help, and minimal contract round trips reject invalid schemas and shapes.

## 2. Ingestion and persisted feature measurements

Implement asset identity, supported-format checks, explicit decoding, and a feature bundle with timestamps and units. Add artifact storage, atomic publication, cache validation, and per-track diagnostics. Include silence and partial-window behavior.

Detailed design: [Audio Analysis Pipeline](superpowers/specs/2026-09-22-audio-analysis-pipeline-design.md).

Done when supported local audio yields inspectable feature artifacts; unchanged input reuses the cache; changed configuration invalidates it; and invalid files fail clearly. Confirm timing and units with synthetic signals.

Implemented as `setvector analyze`, which persists RMS, spectral centroid, bass power ratio, onset strength, estimated tempo, and beats. It works with network sockets blocked. Tempo has no pulse-confidence measure; onset strength is normalized within each track, and RMS is not standardized loudness. These outputs do not yet provide calibrated cross-track energy.

## 3. First interactive report

Render raw feature curves with aligned time axes, units, beat estimates, and quality flags. Export a self-contained HTML report and document library and CLI usage. The [track-report design](superpowers/specs/2026-09-22-interactive-track-report-design.md) and [detailed plan](superpowers/plans/2026-09-22-interactive-track-report.md) specify this stage.

Done when a report opens without a network connection, regenerates from saved artifacts without reanalysis, and has been inspected on a representative real track and silence. The report can later help review cues, but annotation storage need not wait for a graphical editor.

Implemented as `setvector report`, a self-contained page with an embedded player, overview, and four synchronized feature lanes. Energy scoring and downbeat detection are not part of this step.

## 4. Evaluation collection and editable annotations

Assemble a local listening collection covering the six styles and difficult cross-style transitions. Include originals and remixes, vocal and percussive sections, and stable and changing pulse. Keep audio outside the repository unless redistribution is permitted. Split development and evaluation by whole track, with related remixes kept together where possible.

Define versioned, validated annotations for track metadata, tempo/beat corrections, tonal candidates, entry/exit cues, transition judgments, and relative energy judgments. Preserve estimates beside human corrections; include annotation identity in downstream caches. Start with a file or CLI workflow so reviewed data can feed the planner before automatic cue detection exists. See [Playlist Engine Evaluation](research/playlist-engine-evaluation.md) and the [detailed prerequisite plan](superpowers/plans/2026-09-22-playlist-analysis-prerequisites.md).

Done when annotations round-trip, invalid or out-of-range cue times are rejected, corrected values do not mutate raw feature artifacts, and a held-out listening set is recorded.

## 5. Library preparation and region summaries

Add batch analysis with per-file progress, failure isolation, and cache reuse. Provide an index or catalog for the intended 200–2,000-track library, with editable artist, style, and remix relationships; choose SQLite only if measured lookup or update needs justify it. Expose summaries of selected source intervals using existing timestamped features, including valid-data coverage and missingness. Compare only compatible analysis configurations.

Done when a partially failing batch preserves successful artifacts, library candidates can be enumerated without re-decoding, and region summaries handle silence, omitted tails, and invalid values correctly. Measure indexing and summary costs on the target library size.

## 6. Reviewed-cue transition and timed-plan contracts

Represent a directional A → B transition using A's exit, B's entry, cut or short-blend type, playback rates, overlap, beat/key-lock assumptions, declared or unknown gain/EQ assumptions, cue provenance, and component measurements. Use confirmed annotations where available. A missing or weak key/beat estimate must produce an explicit unknown or review-needed result, with a cut available as an alternative to an unsupported blend. Keep a transition feature vector separate from any experimental utility score.

Define ordered track occurrences and timed placements with source in/out times, set starts, rates, and overlaps. Check that B's chosen entry from A leaves a valid span before B's exit into C. Derive planned duration from placements, not from the sum of source-file durations. Audio rendering is outside this stage.

Done when A → B and B → A can differ for an explained reason, changing a cue changes the result, adjacent cue choices remain feasible across the full plan, and repeated tracks, trims, gaps, and overlaps have correct timeline accounting.

## 7. First DJ preparation planner

Implement a shared request/result contract with mode, selection policy, candidate IDs, required/excluded tracks, start/end anchors, duration or count bounds, repeat policy, tempo-adjustment limits, explicit track preferences, missing-evidence policy, and versioned scoring configuration. First reorder a supplied crate with reviewed cues; then add choose-from-library selection under the same contract. Keep constraints hard and report contradictory input separately from a bounded search that found no plan.

Define a deterministic, explainable baseline objective before choosing an optimizer: track inclusion preference plus directional transition utility, minus penalties for arc deviation and unwanted repetition or sameness. Use user energy annotations for an early arc experiment. Specify component scales and weights in the saved configuration; never silently reweight a track because a measurement is missing. Use an explicit reduced-feature model or return a review-needed result. Pool selection needs a count or duration bound and inclusion utility so an empty or trivial plan cannot win.

Use greedy sequencing as a baseline. Compare bounded multi-start beam search with swap/insertion improvement, adding replacement moves for library selection. Preserve mandatory tracks and diverse candidates during pruning. Track the current entry cue and elapsed planned time during search; reevaluate changed directional edges after local moves. Return several distinct plans with duration, transition explanations, worst-pair warnings, uncertainty, provenance, and search-budget status. Call a result “best found within the budget” unless optimality is proved on a small exact instance.

Done when both selection policies produce valid, reviewable 1–3 hour plans from the target-size library within the agreed budget, and small exact cases, greedy baselines, and blind DJ judgments reveal the heuristic's strengths and failures. Initial user energy annotations may guide an arc, but automated cross-track energy claims wait for Step 9.

## 8. Rhythm, harmony, and cue analysis

Add separately versioned analysis outputs for tempo alternatives and pulse stability, beat phase, downbeat/meter candidates, time-local chroma/key candidates with ambiguity, and candidate section boundaries. Evaluate whether vocal/percussive activity improves cue choices. Preserve unknown states, estimator strength, source timing, and user corrections. A detected section boundary is not automatically a verified phrase or drop. Avoid hard genre rules for Bollywood or BollyHouse; evaluate their actual tracks and transition regions. See [Harmonic and Transition Research](research/harmonic-and-transition-research.md) and [analysis-engine extension research](research/analysis-engine-extension.md).

The current feature bundle and artifact reader require exactly four scalar series and one-dimensional arrays. Introduce compatible versioned contracts or separate derived artifacts for chroma and other new measurements without silently changing old cache semantics.

Done when held-out annotations quantify key, tempo, beat, downbeat, and cue errors by style and cross-style pair; the planner explains uncertainty and offers reviewed or cut fallbacks when automatic evidence is weak. Set reliability and abstention criteria from a pilot before enabling each automatic transition type by default. Claim phrase-aligned blends only when phrase evidence meets its declared criteria.

## 9. Energy experiment and calibration

Keep within-track dynamics separate from cross-track energy. Test additional candidate measurements such as standardized loudness, dynamics, and rhythmic/bass activity against human judgments; do not assume any is perceived energy on its own. Fit a frozen cross-track calibration profile on the development collection and persist population identity, transforms, weights, smoothing, contributions, and quality states. Score only compatible feature/model/profile combinations, or explicitly rescore both tracks.

Done when weight changes reuse raw features, results from different profiles cannot be silently compared, and held-out pairwise energy judgments and landmarks are compared with loudness-only and tempo-only baselines. Report disagreement and ablations. Enable an automatically scored target energy arc, evaluated against elapsed planned playback time, only if the model meets acceptance criteria set from a pilot and its observed result is documented. Otherwise retain the experimental or user-annotated arc path.

## 10. Automatic DJ suggestions and listening flow

Use rhythm, harmony, structure, and energy outputs that meet their stage-specific acceptance criteria to propose entry/exit regions automatically while keeping corrections and review flags. Recompute whole-plan cue compatibility and duration whenever a suggestion changes. Compare automatic suggestions with reviewed-cue and simple-rule baselines in blind transition tests; do not promise a seamless mix from BPM or Camelot adjacency alone.

Add a listening-flow scoring profile over the same selection/reordering engine. Ordinary playback uses full-track duration unless the request states otherwise; weigh continuity, variety, artist/remix spacing, and the requested progression without imposing beatmatched-overlap rules. Evaluate complete sequences separately from DJ transition excerpts.

Done when both modes and both selection policies expose component scores, constraints, unknown information, and alternatives; offline integration checks pass; and held-out listeners/DJs can compare them fairly against random, BPM-sort, Camelot-only, greedy, and human-prepared plans.

## 11. Research-led extensions

Use measured bottlenecks to decide whether to add SQLite migrations, process workers, or block processing. Use listening evidence to decide whether learned embeddings, personalization, or alternate optimizers improve the validated baseline. Recorded-mix analysis and rendered mix audio remain separate work from planning. Each extension needs an explicit objective, evaluation method, and architecture decision.
