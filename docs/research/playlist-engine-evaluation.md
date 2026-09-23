# Playlist Engine Evaluation

## Questions to answer

Playlist quality is partly subjective. Technical checks can prove that a plan satisfies stated constraints and that features are timed correctly; they cannot establish that listeners or DJs prefer its flow. Evaluate four questions separately:

1. Are key, pulse, downbeat, and candidate boundary estimates useful on the intended collection?
2. Do proposed A → B transition regions work better than simpler cue choices for DJ preparation?
3. Does the selected and ordered full playlist express the requested energy arc and balance continuity with variety?
4. Does the planner improve outcomes over simpler orderings in each mode and selection policy?

This separation follows the distinction between transition, track, and mix timescales in [Temporal Considerations in DJ Mix Information Retrieval and Generation](https://drops.dagstuhl.de/storage/00lipics/lipics-vol355-time2025/LIPIcs.TIME.2025.20/LIPIcs.TIME.2025.20.pdf). A [Spotify sequencing trial](https://research.atspotify.com/2023/10/exploiting-sequential-music-preferences-via-optimisation-based-sequencing) measured listening behavior at scale, but its streaming interaction data and results cannot validate an offline DJ planner. A small curator pilot in [Bittner et al.](https://archives.ismir.net/ismir2017/paper/000086.pdf) is useful as a blind-comparison pattern, not as a sample size or acceptance threshold for SetVector.

## Collection and annotations

Build a locally held collection covering House, Hip-hop, Pop, EDM, BollyHouse, and Bollywood. Allow more than one style tag per track; a BollyHouse edit may also be House and Bollywood-related. Stratify the sample by track and transition characteristics that matter to the algorithms: original versus remix, stable versus changing pulse, instrumental versus vocal entry/exit, sparse versus dense harmony, and percussive versus melodic overlap. Include easy and deliberately difficult cross-style pairs. Do not infer musical behavior solely from a genre tag.

Keep source audio outside the repository unless redistribution rights permit it. Version an annotation manifest referring to asset IDs and local feature IDs; share only metadata or examples with appropriate permission. Each annotation should retain the reviewer, source region in seconds, task, correction or judgment, and whether it is an estimate or human decision. The project architecture already requires model estimates and corrections to be separate and included in downstream identities. [Architecture](../architecture.md#core-data-contracts)

Useful human annotations include:

| Level | Annotation |
|---|---|
| Track | Style tags, tempo or tactus alternatives, key or “not meaningful/uncertain,” and relative energy judgments against other tracks |
| Region | Beat/downbeat anchors where discernible, candidate section boundaries, local tonality, vocal activity, entry/exit cue suitability |
| Pair | A → B transition type, cue pair, feasible tempo adjustment, harmonic or vocal clash, and blind preference between alternatives |
| Sequence | Intended arc, accepted track substitutions, abrupt or dull points, overall preference, and reasons for manual changes |

Use a development subset for feature design and weight fitting. Hold out whole tracks and, where possible, artists and closely related remixes for final evaluation; windows of one track must not appear on both sides. Report results by style slice and on cross-style transitions. Do not claim broad mixed-genre accuracy from an EDM-only or Drum and Bass-only benchmark: the latter explicitly used genre-specific structure assumptions. [Vande Veire and De Bie](https://link.springer.com/article/10.1186/s13636-018-0134-8)

## Technical evaluation

For key estimates, report exact tonic/mode accuracy, relative/parallel/fifth errors, unknown/abstention coverage, and behavior by style. [mir_eval's key metrics](https://mir-eval.readthedocs.io/latest/api/key.html) can supplement exact accuracy, but their partial-credit weights are conventional evaluation rules, not probabilities that two tracks will blend successfully. For beats, report strict timing and continuity along with half/double-level tolerant results; score downbeats and meter separately. [mir_eval's beat metrics](https://mir-eval.readthedocs.io/latest/api/beat.html) distinguish these cases. Human checks of actual cue regions remain necessary.

For each generated plan, verify required/excluded tracks, uniqueness or permitted repeats, fixed endpoints, cue ordering, source bounds, and duration accounting. Duration for DJ mode must use selected played spans and planned overlaps; a listening playlist normally uses full-track duration. Measure runtime and peak memory for representative candidate-pool sizes. A heuristic that finds no plan has not proved the request infeasible. Exact search on small instances can check the objective and feasibility logic.

Track score components separately:

- Mean, median, and worst transition cost, with the component explanations and proportion requiring manual review.
- Deviation from a requested energy curve by **elapsed planned playback time**, only after energy scores use one compatible calibration profile.
- Artist/remix spacing, style coverage, and excessive sameness, without treating maximum difference as intrinsically better.
- Duration error, unsatisfied hard constraints, and optimizer gap where an exact reference is available.

## Listening evaluation

Compare at least random ordering, BPM sort, Camelot-only ordering where keys are available, greedy nearest neighbor, the proposed planner, and a human-prepared reference when one exists. Keep the same candidate pool and hard constraints for each comparison; mark baselines unable to satisfy them instead of silently changing the task. Ablate harmonic, tempo, energy-arc, cue, and diversity terms to learn which parts help. A [2025 playlist-coherence study](https://link.springer.com/article/10.1140/epjds/s13688-025-00531-3) reinforces why local smoothness and whole-playlist diversity need separate measurements.

Run blind, randomized pairwise comparisons with different prompts for the two modes. For DJ preparation, reviewers should hear the proposed entry/exit excerpts, know the intended transition type, and judge mix feasibility, clashes, cue placement, and usefulness of the explanation. For listening flow, reviewers should judge neighboring passages and selected complete sequences for pacing, variety, arc, and willingness to keep listening. Record ties, disagreement, and failures; a single mean preference score hides valuable style-specific behavior. Local opt-in ratings can later refine preferences without telemetry or cloud inference.

Set numerical performance and listening targets only after a pilot establishes the library size, planning latency budget, reviewer protocol, and realistic baseline. Compare held-out judgments before adopting default weights. A validated engine should communicate the conditions under which it works well, abstains, or needs a DJ's correction.
