# Playlist Creation Engine Research

## Purpose

SetVector should help create an ordered playlist from either a selected track list or a larger local library. Two selectable modes serve different intents:

| Mode | Intended result | Main sequencing concern |
|---|---|---|
| DJ preparation | Ordered set with suggested entry and exit points, transition type, and assumptions | Whether adjacent tracks can be mixed at specific regions while following the set's intended arc |
| Listening flow | Ordered tracks for ordinary playback | Whether the sequence balances continuity, variety, and the listener's intended progression |

The first planning result is a proposal for a person to inspect and edit. It does not render mixed audio or assert that a sequence is musically optimal. Selection, ordering, transition suggestions, and audio rendering are distinct tasks. The [architecture](../architecture.md) already separates ordered playlists from timed set plans and recorded mixes.

Planning, feature extraction, scoring, and review must run from local files after dependencies are installed, without an API key, hosted model, telemetry, or network access. Optional future integrations must not alter this core path. [Offline architecture](../architecture.md#offline-operation)

The evaluation collection should include House, Hip-hop, Pop, EDM, BollyHouse, and Bollywood. Those labels describe the intended collection, not fixed rules for every track. A mixed-genre planner must permit both smooth blends and deliberate changes in style or energy.

## Research findings

- Bittner et al. model fixed-list sequencing as a shortest nonrepeating path through a graph of tracks. Their features include timbre, key relationships, and log tempo. Greedy methods are fast but can leave poor pairings at path ends. Their small blind curator study reduced mean flagged abrupt pairs from 4.2 to 2.4 per 30-track playlist; individual playlists did not all improve. This supports a graph baseline and human evaluation, not universal weights. [Automatic Playlist Sequencing and Transitions](https://archives.ismir.net/ismir2017/paper/000086.pdf)
- Pauws et al. formulate playlist generation with position, pairwise, and global constraints. Their local search uses replacement, insertion, deletion, and swapping, which explains why selection plus ordering needs more moves than fixed-list reordering. Their comparison is to a particular earlier constraint solver, not evidence that one modern optimizer is always best. [Fast Generation of Optimal Music Playlists Using Local Search](https://ismir2006.ismir.net/PAPERS/ISMIR0631_Paper.pdf)
- Research on playlist coherence distinguishes diversity across a whole playlist from continuity between neighbors. A 2025 study measured these separately across a large collection of user-curated playlists; it does not define one degree of smoothness that is best for every intent. [The impact of playlist characteristics on coherence in user-curated music playlists](https://link.springer.com/article/10.1140/epjds/s13688-025-00531-3)
- A large streaming-service trial found that position and neighboring tracks affected listening outcomes. Its learned preferences used interaction histories that SetVector does not have, so its reported completion and skip improvements should not be transferred to an offline audio-only planner. [Exploiting Sequential Music Preferences via Optimisation-Based Sequencing](https://research.atspotify.com/publications/exploiting-sequential-music-preferences-via-optimisation-based-sequencing)
- DJ planning operates at transition, track, and whole-set timescales. Optimizing only neighboring-track similarity can miss the larger arc, while a good arc does not guarantee usable cue points. [Temporal Considerations in DJ Mix Information Retrieval and Generation](https://drops.dagstuhl.de/storage/00lipics/lipics-vol355-time2025/LIPIcs.TIME.2025.20/LIPIcs.TIME.2025.20.pdf)

## Proposed planning problem

One request should state the candidate track IDs, mode, selection policy (`use every supplied track` or `choose from pool`), target track count or duration, required/excluded tracks, optional start/end anchors, repeat policy, and intended energy progression. A selection request needs a count or duration bound and a declared reason to include tracks; otherwise the cheapest result may be an empty or trivial list. Preferences such as artist spacing, style changes, and acceptable tempo adjustment should be explicit. An energy curve is useful only after a common calibration makes scores comparable across tracks; until then, user annotations or simpler declared goals can drive experiments. [SetVector's energy model](../architecture.md#energy-model-and-comparability) makes this distinction.

For a candidate sequence `P = (p1, ..., pn)`, a research objective could be:

```text
utility(P) = track-preference(P)
           + adjacent-transition-utility(P, mode)
           - target-arc-deviation(P)
           - repetition-and-diversity-penalties(P)
```

Duration, required tracks, exclusions, fixed endpoints, and no-repeat requirements are hard constraints. The terms above are hypotheses whose scales and weights need a calibration collection and held-out listening judgments. A high mean transition score must not conceal one unusable transition; report both the distribution and worst pairs. Missing measurements should remain visible, rather than becoming zeros or invented certainty.

An adjacent transition is **directional**: the exit of A and entry of B, their cue regions, playback rate, overlap duration, key-lock setting, and possible cut or blend determine the comparison. DJ mode can place more emphasis on rhythm, phrase, and harmonic overlap where two tonal regions play together. Listening mode can emphasize pacing and variety; key compatibility matters less when one track ends before the next begins. Score an arc against cumulative **played time**, not just track position; short interludes and long tracks occupy different fractions of the set. See [Harmonic and Transition Research](harmonic-and-transition-research.md).

## Search approaches

| Approach | Use | Limitation |
|---|---|---|
| Greedy nearest next track | Reproducible baseline and instant preview | Can leave difficult tracks for the end; optimizes one step at a time |
| Multi-start beam search with insert/swap improvement | Proposed first planner for both selection and reordering | Approximate; requires candidate pruning, time and memory budgets, and a clear fallback when constraints conflict |
| Exact search on small collections | Check heuristic quality and constraint handling | Combinatorial growth limits routine library use |

The graph-path formulation in Bittner et al. and the local-search formulation in Pauws et al. motivate these comparisons. The beam-search proposal is an engineering inference, not a proven best algorithm for this collection. Construct the first version with a transparent, deterministic score and bounded search. Cache measurements by artifact identity; compute or shortlist pair/cue scores as needed instead of assuming a full library-wide pair matrix is affordable. Preserve mandatory tracks and plausible candidates for different stages of the requested arc during pruning. Return several meaningfully different plans when scores are close and explain which constraints or weak measurements shaped each one. A heuristic search failure is not proof that no feasible playlist exists.

Cue choices must be feasible across the **whole** route. If A → B selects a late entry into B, the B → C exit must still leave a valid played span. Pair scores cannot simply be minimized independently. Directional pair costs also make ordinary symmetric traveling-salesperson shortcut formulas unsafe for reversal moves; reevaluate all changed directed edges.

Selection and ordering share the same track and transition representation. `use every supplied track` fixes the selected set; `choose from pool` also decides membership under duration and preference constraints. A plan should keep track occurrence IDs separate from asset IDs so repeated plays remain representable, as required by [timed set planning](../architecture.md#transition-and-set-extensions).

## Fit with the current repository

The implemented `analyze` workflow persists RMS, spectral centroid, bass power ratio, onset strength, a global tempo estimate, and beat positions. It does not yet supply key, downbeats, phrases, cue regions, or calibrated cross-track energy. The tempo estimate lacks a pulse-confidence measure. [Onset strength is scaled by each track's own peak](../../src/setvector/analysis/baseline.py), while RMS is raw amplitude rather than standardized loudness, so their summaries should not be treated as a ready-made cross-track energy ranking. The latest track-report work is a design and implementation plan, not an implemented report. These gaps prevent a defensible automatic claim that two tracks will mix smoothly or that one is more energetic than another. See the [implementation plan](../implementation-plan.md).

Research and implementation can proceed in this order:

1. Build a representative, rights-respecting local evaluation collection and record human corrections and judgments.
2. Compare offline key, tempo, downbeat, and section candidates on that collection; preserve alternatives and abstain when evidence is weak.
3. Calibrate cross-track energy independently of within-track display scaling.
4. Define region-aware directional transition candidates, including explicit cut or blend assumptions.
5. Compare greedy, improved approximate, and small exact search on both modes and both selection policies. Use [Playlist Engine Evaluation](playlist-engine-evaluation.md) before treating default weights as established.

Before fixing release behavior, the project still needs a target library size, supported audio formats and operating systems, a planning latency budget, the initial transition types, and the way users specify an energy arc. These open scope items are also recorded in the [architecture](../architecture.md#release-scope).
