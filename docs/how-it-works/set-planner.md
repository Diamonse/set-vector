# Set planner

The web app's planner turns a list of candidate tracks into an ordered set. In **DJ mode** it also picks an entry and exit region for each track, a transition type and overlap length, and a playback rate. In **listening mode** whole tracks play one after another. Every adjacent pair gets a transparent 0–1 **transition cost**; a whole sequence gets an **objective** that adds the mean and worst transition costs, the fit to a requested **energy arc**, an artist and style **diversity** penalty, a duration penalty, and a fixed penalty per broken hard constraint. A beam search builds starting orders, local search improves them, and the result is reported next to simple **baselines** and, for small crates, an exhaustive optimum.

All weights and thresholds are declared starting hypotheses, not fitted values (`MODE_WEIGHTS` says so in its comment). The planner runs on the server inside a Next.js server action, needs no network service beyond the app's own database, and builds no library-wide pair matrix.

## Pipeline at a glance

1. **Validate** the posted request with Zod, then check it against the library (`prepareRequest`). Contradictions throw; data gaps become warnings.
2. **Prune** the candidates to at most `maxCandidates`, keeping required and anchored tracks and every energy band.
3. **Resolve the target count** from the selection policy, track count or duration.
4. For each track, list **entry and exit options**: cue regions, or a labelled fallback window.
5. Score **directional transitions** lazily, one exit option to one entry option, and cache them.
6. **Beam search** builds candidate orders from a cheap step score (30 % of the time budget).
7. **Local search** (swap, relocate, and in pool mode replace, add, remove) improves several beam results under the full objective. Each evaluation assigns cues **jointly** along the sequence (Viterbi).
8. Pick the best as the **proposal**, keep up to `alternatives` close but different plans, run four **baselines** on the same tracks, and for fixed crates of up to 8 tracks run the **exact solver** to measure the optimizer gap.
9. **Save** the request and result as JSON on the plan, write one `plan_items` row per track, and allow edits, adoption of an alternative, transition judgments, and CSV or JSON **export**.

Code: `web/src/lib/planner/index.ts` → `planSet`.

---

## 1. The plan request

A `PlanRequest` is everything the planner needs besides the tracks. The form starts from `defaultPlanRequest(mode)`.

| Field | Meaning | Default | Allowed by the schema |
|---|---|---|---|
| `mode` | `dj` or `listening` | from the form | enum |
| `selectionPolicy` | `use_all` (reorder the crate) or `choose_from_pool` (also choose which tracks) | `use_all` | enum |
| `candidateTrackIds` | Tracks the planner may use | crate or selection | 1–5000 UUIDs |
| `targetCount` | Number of tracks (pool mode) | `null` | integer 1–500 or `null` |
| `targetDuration` | `{minMinutes, maxMinutes}` of planned playback | `null` | 1–1440 each, or `null` |
| `requiredTrackIds`, `excludedTrackIds` | Must appear / must not appear | `[]` | ≤ 500 / ≤ 5000 |
| `startTrackId`, `endTrackId` | Fixed opening and closing track | `null` | UUID or `null` |
| `repeatPolicy` | `allowRepeats`, `minGapTracks` (other tracks between two plays) | `false`, 10 | gap 0–200 |
| `energyArc` | `preset` and `points` (see section 8) | `peak` | ≤ 12 points, $t\in[0,1]$, energy 1–10 |
| `preferences.maxTempoAdjustPct` | Largest tempo change a beatmatched overlap may assume | 6 | 0–20 |
| `preferences.artistSpacing` | Minimum other tracks between same artist or remix family | 3 | 0–20 |
| `preferences.keyLock` | Playback keeps the original key when tempo changes | `true` | boolean |
| `preferences.transitionPreference` | `auto`, `cut`, or `blend` | `auto` | enum |
| `preferences.minPlayedSeconds` | Minimum played span per track (DJ only) | 60 (DJ), 0 (listening) | 0–600 |
| `weights` | Transition component weights and objective weights | `MODE_WEIGHTS[mode]` | each 0–10 |
| `search` | `beamWidth` 12, `branchFactor` 10, `maxCandidates` 160, `timeBudgetMs` 2500, `seed` 7, `alternatives` 2 | | 1–64, 1–64, 2–400, 200–10000, 0–2³¹−1, 0–4 |

**Default weights per mode** (`MODE_WEIGHTS`):

| Weight | DJ | Listening |
|---|---|---|
| Transition: harmonic | 1 | 0.2 |
| Transition: tempo | 1.2 | 0.5 |
| Transition: energy step | 0.6 | 0.8 |
| Transition: cue | 0.8 | 0 |
| Transition: vocal | 0.5 | 0 |
| Transition: style | 0.15 | 0.35 |
| Objective: mean transition | 1 | 1 |
| Objective: worst transition | 0.35 | 0.25 |
| Objective: arc | 1 | 1 |
| Objective: diversity | 0.5 | 0.8 |

The intuition: a DJ blend puts two tracks on top of each other, so tempo, key, cues and vocals matter most. In a listening playlist one track ends before the next starts, so pacing (energy) and variety (style, diversity) matter more and key barely matters.

**Request checks.** `prepareRequest` drops candidate IDs that no longer exist (with a warning) and removes excluded ones. It throws `PlanRequestError` when: no candidates remain; a track is both required and excluded; a required track or an anchor is not a candidate; the same track opens and closes without repeats; the duration range is not positive with min ≤ max; pool mode has neither a count nor a duration ("otherwise the cheapest plan is trivially short"); the count is below the number of required and anchored tracks; or the count exceeds the candidates without repeats. It warns about tracks without energy (when an arc is set), without a usable key, without BPM (DJ: "transitions default to cuts"), and, in DJ mode, without any non-rejected cue.

Code: `web/src/lib/planner/types.ts` → `PlanRequest`; `web/src/lib/planner/defaults.ts` → `defaultPlanRequest`, `MODE_WEIGHTS`; `web/src/lib/validation/plan-request.ts` → `planRequestSchema`, `createPlanSchema`; `web/src/lib/planner/index.ts` → `prepareRequest`.

## 2. Candidate pruning and target count

**Pruning.** Search cost grows with the pool, so when there are more than $L = \max(\texttt{maxCandidates}, 2)$ candidates the planner keeps a subset. Required and anchored tracks are always kept. The rest are grouped into energy bands so that every stage of the arc still has candidates:

```math
\mathrm{band}(e) = \min\!\left(4,\ \left\lfloor \frac{e-1}{2} \right\rfloor\right)
```

That gives bands for energy 1–<3, 3–<5, 5–<7, 7–<9, 9–10, plus `unknown`. Within a band, tracks are sorted by **completeness** (one point each for a BPM, a usable key, an energy value, and at least one `approved` cue), most complete first, then by ID. Bands are visited in sorted key order (`0`…`4`, `unknown`), taking one track from each per round until $L$ is reached. A warning reports how many candidates were considered.

**Target count.** In `use_all` mode it is the pool size. In pool mode it is `targetCount` if given, otherwise

```math
n = \operatorname{round}\!\left(\frac{(\text{min} + \text{max})/2}{\max(1,\ \overline{\text{typical played}})}\right)
```

where the average typical played span is taken over the pool (section 3). The count is clamped to at least $\max(1, \#\text{required and anchored})$ and at most the pool size (or $\max(\text{pool}, 200)$ when repeats are allowed).

Code: `web/src/lib/planner/index.ts` → `pruneCandidates`, `resolveTargetCount`.

## 3. Entry and exit options

**What and why.** A DJ transition happens at specific places in each track, so the planner works with **options**: regions where track B may be entered or track A may be left. Pair scores are computed per (exit option, entry option), not per track pair.

**DJ mode.** Options are the track's cue regions of that kind that are not `rejected` and end within the file, sorted by start. Each gets an **origin**: `pending` if its review status is pending; otherwise `reviewed` if its provenance is `reviewed`, else `estimated`. If a track has no usable cue of a kind, it gets one **fallback** option: an intro window starting at 0 or an outro window ending at the track end, of length

```math
\ell = \min\!\left(\max\!\left(\frac{32 \cdot 60}{\text{BPM}},\ 8\right),\ 60,\ \frac{\text{duration}}{3}\right)
```

with 30 s in place of the 32-beat phrase when BPM is unknown. At 124 BPM that is 15.5 s. The 32 beats are an assumed phrase length, not a detected one.

Where the options come from: the browser analyzer suggests up to three entries and three exits on 8-bar phrase starts (`pending`, so origin `pending` until reviewed; see [key-loudness-structure.md](key-loudness-structure.md)). A Rekordbox import turns the user's own cues into `reviewed`, `approved` regions (origin `reviewed`, cue cost 0), and adds `pending` phrase suggestions from the Rekordbox grid for a role with no usable cue ([rekordbox-bridge.md](rekordbox-bridge.md)). With several options per kind, the joint cue assignment (section 9) picks the pair that fits each transition.

**Listening mode.** One option each: "Track start" $[0, w]$ and "Track end" $[\text{duration}-w, \text{duration}]$ with $w = \min(20, \text{duration}/4)$, origin `full_track`, vocal activity unknown.

**Typical played span** is used before cues are assigned (pruning, target count, beam search): in DJ mode the last exit option's start minus the first entry option's start (or the full duration if that is not positive); in listening mode the full duration.

| Constant | Value | Use |
|---|---|---|
| `FALLBACK_REGION_SECONDS` | 30 | Fallback length without BPM; cap is twice this |
| `BLEND_BEATS` | 32 | Long blend and fallback window length |
| `SHORT_BLEND_BEATS` | 8 | Short blend length |
| `MIN_BLEND_BEATS` | 4 | Shorter regions force a cut |

Code: `web/src/lib/planner/options.ts` → `cueOptions`, `typicalPlayedSeconds`; `web/src/lib/planner/defaults.ts`.

## 4. Tempo matching

**What and why.** To beatmatch, B is played at a rate that makes its pulse match A's. A track at 64 BPM can be mixed with one at 128 BPM by counting it at double time, so half and double time are allowed, plus any alternative tactus stored on B.

For B's primary BPM $b$ and alternatives $a_1, a_2, \dots$, the candidates are $\tilde b \in \{b,\ 2b,\ b/2,\ a_1, a_2, \dots\}$. Each gives

```math
r = \frac{\text{BPM}_A}{\tilde b}, \qquad \Delta\% = 100\,(r - 1)
```

and the candidate with the smallest $\lvert\Delta\%\rvert$ wins (earlier candidates win ties within $10^{-9}$). The **multiple** is $\tilde b/b$ (1, 2, 0.5, or the alternative's ratio). The rate applies to B, so the relation is directional: 124 → 128 BPM is −3.125 %, while 128 → 124 is +3.226 %.

Code: `web/src/lib/planner/transition.ts` → `matchTempo`.

## 5. Transition type and overlap

The type decides how long the two tracks overlap and how much key and vocals matter.

- Listening mode: always `sequential`, overlap 0.
- DJ mode: `cut` (overlap 0) if either BPM is missing, $\lvert\Delta\%\rvert$ exceeds `maxTempoAdjustPct`, or the preference is `cut`.
- Otherwise, with beat length $\beta = 60/\text{BPM}_A$ and $\text{avail} = \min(\text{exit length}, \text{entry length})$:
  - $\text{avail} < 4\beta$ → `cut`.
  - Preference `blend` → `blend`, overlap $\min(\text{avail}, 32\beta)$.
  - Keys usable on both sides with `compareKeys` cost ≤ 0.2 (same, adjacent, or relative), no vocal clash (vocals `present` in both regions), and $\min(\text{avail}, 32\beta) \ge 16\beta$ → `blend`, overlap $\min(\text{avail}, 32\beta)$.
  - Otherwise `short_blend`, overlap $\min(\text{avail}, 8\beta)$.

Code: `web/src/lib/planner/transition.ts` → `evaluateTransition`.

## 6. Pairwise transition cost

Each transition has six components. Every component cost is clamped to $[0,1]$ and carries a status: `measured`, `missing` (evidence absent, so a neutral cost is used rather than zero), or `not_applicable` (left out of the average). The total is a **weighted average**:

```math
C(A \to B) = \frac{\sum_k w_k\, c_k}{\sum_k w_k}
\qquad \text{over components with } w_k > 0 \text{ and status} \ne \text{not applicable}
```

(0 if no component qualifies). Because it is an average, lowering one weight raises the relative influence of the others; it does not simply remove a penalty. Harmonic and vocal weights are scaled by the transition type:

| Type | Harmonic factor $f_h$ | Vocal factor $f_v$ |
|---|---|---|
| `blend` | 1 | 1 |
| `short_blend` | 0.6 | 0.6 |
| `cut` | 0.15 | 0 (not applicable) |
| `sequential` | 1 | 0 (not applicable) |

### 6.1 Harmonic (Camelot)

**Intuition.** Keys close on the Camelot wheel share most of their notes, so they clash less when they overlap. The wheel is a ranking heuristic, not a measurement of how two passages sound together.

A key is usable only when tonic and mode are set and the status is not `unknown`, `uncertain` or `not_meaningful`. The Camelot number is $n = (7\cdot\text{tonic} + o) \bmod 12$ with $o = 5$ for minor (letter A) and $o = 8$ for major (letter B), writing 0 as 12. The wheel distance is $s = \min(d, 12 - d)$ with $d = \lvert n_A - n_B\rvert \bmod 12$. See [key-loudness-structure.md](key-loudness-structure.md) for how keys are estimated.

| Relation | Condition | Cost |
|---|---|---|
| same | $s=0$, same letter | 0 |
| adjacent | $s=1$, same letter | 0.15 |
| relative | $s=0$, other letter | 0.2 |
| diagonal | $s=1$, other letter | 0.45 |
| two_steps | $s=2$, same letter | 0.5 |
| distant | anything else | $\min(1,\ 0.6 + 0.1(s-2) + 0.05\,[\text{other letter}])$ |

So a 6-step move costs 1.0, and a 2-step move across letters costs 0.65.

**Without key lock** (DJ types only), B's pitch moves with its rate: $\sigma = 12\log_2 r$ semitones. B's key is transposed by $\operatorname{round}(\sigma)$ before comparison, and 0.2 is added if $\lvert\sigma - \operatorname{round}(\sigma)\rvert > 0.25$ (the pitch lands between semitones). The sum is clamped to 1.

**Missing key** on either side: cost 0.4, status `missing`, and the transition is flagged for review if it is a blend or short blend.

Weight: $w = W_\text{harmonic} \cdot f_h(\text{type})$.

### 6.2 Tempo

**DJ mode.** With limit $L$ = `maxTempoAdjustPct` and $p = \lvert\Delta\%\rvert$:

```math
c_\text{tempo} = \min\!\left(1,\ 0.85\cdot\begin{cases} p/L & p \le L \\ 1 & p > L \end{cases} \;+\; 0.15\cdot[\text{multiple} \ne 1]\right)
```

A larger stretch costs more, linearly up to the limit; half/double time or an alternative tactus adds 0.15 because it is a less certain match.

**Listening mode.** No beatmatching, just how different the tempos feel, on a log scale where a 12 % difference is maximal:

```math
c_\text{tempo} = \min\!\left(1,\ \frac{\lvert\ln r\rvert}{\ln 1.12}\right)
```

**Missing BPM:** cost 0.5, status `missing`; flagged for review in DJ mode.

Weight: $W_\text{tempo}$.

### 6.3 Energy step

Energy is the track's relative energy on a 1–10 scale: the user's rating when there is one, otherwise the automatic library-relative estimate ([energy-estimate.md](energy-estimate.md)). The planner reads both the same way. A step of up to 1 is free, and the cost reaches 1 at a step of 5:

```math
c_\text{energy} = \min\!\left(1,\ \frac{\max(0,\ \lvert E_B - E_A\rvert - 1)}{4}\right)
```

Direction is ignored here; whether the set should rise or fall is the arc's job (section 8). Missing energy on either side: 0.3, `missing`. Weight: $W_\text{energyStep}$.

### 6.4 Cue provenance

DJ mode only (listening: `not_applicable`). The average of a per-origin cost for the exit and entry option, so unverified mix points cost more:

| Origin | `reviewed` | `full_track` | `estimated` | `pending` | `fallback` |
|---|---|---|---|---|---|
| Cost | 0 | 0 | 0.35 | 0.4 | 0.7 |

```math
c_\text{cue} = \tfrac12\left(o(\text{exit}) + o(\text{entry})\right)
```

Any origin other than `reviewed` flags the transition for review. Weight: $W_\text{cue}$.

### 6.5 Vocal overlap

Two vocals on top of each other usually clash. Using the cue regions' `vocalActivity`:

- type `cut` or `sequential`: `not_applicable`;
- `present` in both regions: 1, flagged for review;
- either `unknown`: 0.3, `missing`;
- otherwise 0.

Weight: $W_\text{vocal}\cdot f_v(\text{type})$.

### 6.6 Style continuity

Shares at least one style tag (case-insensitive): 0. No shared tag: 0.5 (a change is allowed, only nudged against). Either track has no tags: 0.2, `missing`. Weight: $W_\text{style}$.

### 6.7 Review flag and explanation

`reviewNeeded` is set by: missing key on a blend or short blend; missing BPM in DJ mode; an exit or entry option that is not `reviewed` (DJ); a vocal clash. The explanation joins short reasons, e.g. "8A to 9A, adjacent on the wheel; about 3.1% tempo adjustment; entry cue unverified; energy 5 to 7 (+2.0); long blend suggested (15 s overlap)".

Code: `web/src/lib/planner/transition.ts` → `evaluateTransition`; `web/src/lib/domain/camelot.ts` → `usableKey`, `toCamelot`, `compareKeys`, `transposeKey`.

## 7. Worked example: scoring one transition

DJ mode, default request (limit 6 %, key lock on, preference `auto`, DJ weights).

- **A:** 124 BPM, A minor (8A), energy 5, style `House`. Exit cue 255–300 s (45 s), provenance `reviewed`, approved, vocals `none`.
- **B:** 128 BPM, E minor (9A), energy 7, styles `House`, `Tech House`. Entry cue 0–30 s, provenance `estimate`, approved, vocals `unknown`.

**Tempo match.** Candidates 128, 256, 64 give $r$ = 0.96875, 0.484, 1.9375. The first is closest: $\Delta\% = -3.125$, multiple 1.

**Type.** $\beta = 60/124 = 0.4839$ s. $\text{avail} = \min(45, 30) = 30$ s ≥ $4\beta$. $32\beta = 15.48$ s ≥ $16\beta$; 8A → 9A costs 0.15 ≤ 0.2; no vocal clash → `blend`, overlap 15.48 s.

| Component | Cost | Weight | $w\cdot c$ |
|---|---|---|---|
| Harmonic: 8A → 9A adjacent | 0.15 | 1 × 1 = 1 | 0.1500 |
| Tempo: $0.85 \times 3.125/6$ | 0.4427 | 1.2 | 0.5313 |
| Energy step: $(2-1)/4$ | 0.25 | 0.6 | 0.1500 |
| Cue: $(0 + 0.35)/2$ | 0.175 | 0.8 | 0.1400 |
| Vocal: entry unknown | 0.3 | 0.5 × 1 = 0.5 | 0.1500 |
| Style: shares `House` | 0 | 0.15 | 0 |
| **Sum** | | **4.25** | **1.1213** |

```math
C = \frac{1.1213}{4.25} = 0.264
```

The transition is flagged for review because B's entry cue is an estimate. Tempo is the largest contributor even though 3 % is a routine adjustment, because it has the highest weight and scales linearly to the 6 % limit.

**Variations.**

- *Forced cut* (`transitionPreference: "cut"`): harmonic weight drops to $1 \times 0.15$, vocal becomes not applicable. $C = (0.0225 + 0.5313 + 0.15 + 0.14 + 0)/2.9 = 0.291$. The cut scores slightly worse because a good component (harmonic) lost weight in the average.
- *Key lock off*: $\sigma = 12\log_2 0.96875 = -0.55$ semitones, rounded to −1, so B sounds as E♭ minor (2A). 8A → 2A is 6 steps, cost 1.0; the residual 0.45 > 0.25 adds 0.2, clamped to 1. The type is still `blend`, because the type check uses the written keys (see Limitations).
- *Reverse direction* B → A: $\Delta\% = +3.226$, so even with identical cues the cost differs; transitions are directional.

## 8. Energy arc

**What and why.** A set usually has a shape: build, peak, release. The user picks a target energy curve over the **fraction of elapsed planned playback time**, not track position, so a long track occupies more of the curve than a short one.

**Presets** (`t` → energy):

| Preset | Label | Points |
|---|---|---|
| `flat` | Sustained | (0, 6), (1, 6) |
| `build` | Gradual build | (0, 4), (1, 9) |
| `peak` (default) | Peak then release | (0, 4), (0.65, 9), (0.85, 9), (1, 6) |
| `wave` | Waves | (0, 5), (0.25, 7.5), (0.5, 5.5), (0.75, 8.5), (1, 6) |
| `cooldown` | Cool down | (0, 8), (1, 4) |
| `opening` | Opening set | (0, 3), (1, 6) |

`none` disables the arc. `custom` uses the request's points; any other preset ignores them. Points are filtered to finite values, $t$ clamped to [0, 1], energy to [1, 10], and sorted. An empty custom list means no arc.

**Target.** Piecewise-linear interpolation, held flat before the first and after the last point:

```math
E^*(u) = E_a + \frac{u - t_a}{t_b - t_a}\,(E_b - E_a) \qquad t_a \le u \le t_b
```

For example, the `peak` target at $u = 0.5$ is $4 + \tfrac{0.5}{0.65}\cdot 5 = 7.85$.

**Score.** Each track $i$ has an *advance* $a_i$ (how much it moves the timeline; section 9) and start time $s_i$. With total time $T$, its target is read at its midpoint $u_i = (s_i + a_i/2)/T$. Over tracks with known energy and $a_i > 0$:

```math
\mathrm{RMSE} = \sqrt{\frac{\sum_i a_i\,(E_i - E^*(u_i))^2}{\sum_i a_i}}, \qquad
\kappa = \frac{\sum_{\text{known}} a_i}{T}
```

```math
c_\text{arc} = \frac{\mathrm{RMSE}}{9}\,\kappa + 0.15\,(1-\kappa)
```

Dividing by 9 (the span of the 1–10 scale) maps the error to roughly 0–1. Time covered by tracks without energy gets a neutral 0.15 instead of zero, so leaving energy blank is not rewarded. If no track has energy, $c_\text{arc} = 0.15$; without an arc, 0. Each item stores its `targetEnergy` for display and export.

Code: `web/src/lib/planner/arc.ts` → `arcPoints`, `targetEnergyAt`, `sampleArc`; `web/src/lib/planner/evaluate.ts` → `evaluateSequence`.

## 9. Joint cue assignment and timeline

**Why jointly.** If A → B uses a late entry into B, B → C must still leave B a playable span. Choosing the cheapest cue pair for each transition independently can produce an impossible set, so the cues for a whole sequence are chosen together.

**Viterbi over entry options.** Let $V_i(e)$ be the cheapest cost of reaching track $i$ through entry option $e$. Start with $V_0(e) = 10^{-6}\cdot \text{start}(e)$ (a tie-breaker for earlier entries). Then

```math
V_{i+1}(e') = \min_{e,\,x}\left[\,V_i(e) + C(x \to e') + 5\cdot[\text{infeasible}(e, x)]\,\right]
```

over entry $e$ and exit $x$ of track $i$. In DJ mode the step is infeasible when the played span $\text{start}(x) - \text{start}(e)$ is ≤ 0 or below `minPlayedSeconds`, or $x$ starts at or after the track end. The last track plays from its entry to the end of the file; +5 if that tail is shorter than `minPlayedSeconds`. Back-pointers recover the chosen options. Any track whose final span is still below $\max(\text{minPlayed}, 10^{-6})$ produces a `cue_conflict` violation.

**Timeline.**

- DJ: track $i$ plays from its entry start. Its *advance* is $\max(0, \text{start}(x_i) - \text{start}(e_i))$: B starts when A reaches its exit cue, and A continues for the overlap, so $\text{playEnd} = \min(\text{duration}, \text{start}(x_i) + \text{overlap})$. The last track plays to its end.
- Listening: every track plays 0 → duration, and the advance is the full duration.

Total planned time $T = \sum_i a_i$; it is shorter than the sum of durations in DJ mode. Each item records `playStartSeconds`, `playEndSeconds`, `elapsedStartSeconds` and `playedSeconds` (including the outgoing overlap).

Code: `web/src/lib/planner/evaluate.ts` → `assignCues`, `evaluateSequence`.

## 10. Diversity and duration

**Artist and remix spacing.** For each track and each of the next `artistSpacing` tracks (so with spacing 3, fewer than 3 tracks in between), count an artist violation when they share an artist token, and a remix violation when they share a non-empty remix group (case-insensitive). Artist strings are lower-cased and split on `,`, `&`, `feat`, `feat.`, `ft`, `ft.`, a standalone `x`, `/` and `;`. Repeated plays of the same track are skipped here (the repeat rule handles them).

**Style runs.** A track's primary style is its first tag. Each track beyond the 4th in a run with the same primary style adds 1 to the run excess $R$.

```math
c_\text{div} = \min\!\left(1,\ \frac{3\,(V_\text{artist} + V_\text{remix} + 0.5\,R)}{\max(1,\ n-1)}\right)
```

**Duration.** With a target $[\text{min}, \text{max}]$ in seconds, the error $\varepsilon$ is the distance of $T$ outside that range. If $\varepsilon > 0$:

```math
c_\text{dur} = 1 + \frac{3\,\varepsilon}{\max\!\left(60,\ (\text{min}+\text{max})/2\right)}
```

and a `duration` violation is listed, but it is not counted in the hard penalty. A request without a duration target has $c_\text{dur} = 0$.

Code: `web/src/lib/planner/evaluate.ts` → `evaluateSequence`, `artistTokens`.

## 11. Plan objective and hard constraints

**Hard constraints** are checked for every sequence: unknown track, missing required track, excluded track present, start anchor, end anchor, repeat (any repeat without `allowRepeats`, or a gap below `minGapTracks`), count (`use_all`: a supplied non-excluded track is missing; pool mode with a count and no duration: wrong length), and cue conflicts. They are penalties rather than filters, so a broken plan still has a finite score and can be shown with its problems.

The objective (lower is better) is

```math
J = W_\text{mean}\,\overline{C} + W_\text{worst}\,\max_i C_i + W_\text{arc}\,c_\text{arc} + W_\text{div}\,c_\text{div} + c_\text{dur} + 3\,H
```

where $\overline{C}$ and $\max_i C_i$ are the mean and worst transition costs and $H$ is the number of non-duration violations. The worst-transition term exists so that one unusable pair is not hidden by a good average. An empty sequence gets $J = 3\max(1, \#\text{violations})$.

Code: `web/src/lib/planner/evaluate.ts` → `constraintViolations`, `evaluateSequence` (constants `HARD_PENALTY = 3`, `INFEASIBLE_STEP = 5`).

## 12. Search

### 12.1 Guide cost

Search needs many cheap pair estimates. `bestPairCost(A, B)` is the minimum $C$ over every (exit of A, entry of B) option pair, cached. It ignores whether those cues are feasible together; the full evaluation fixes that. Transitions are computed lazily and cached by option IDs.

### 12.2 Beam search

**Idea.** Build sequences left to right, but keep the best `beamWidth` partial sequences rather than only one, so an early choice that looks cheap but leads to a dead end can be outvoted.

**Step score** for appending track $x$ to a partial sequence ending in $p$, with elapsed typical time $\tau$:

```math
\Delta = W_\text{mean}\,\mathrm{best}(p, x) + W_\text{arc}\cdot\begin{cases}\lvert E_x - E^*(u)\rvert/9 & E_x \text{ known}\\ 0.15 & \text{otherwise}\end{cases} + 0.5\,W_\text{div}\,(m_\text{artist} + m_\text{remix})
```

with $u = (\tau + \text{typical}(x)/2)/\max(1, \hat T)$. $\hat T$ is the midpoint of the duration target, or the pool's average typical span × target count. The arc term is present only when an arc is set; $m$ counts matches against the last `artistSpacing` placed tracks. A state's score is the sum of its step scores.

**Procedure.**

1. Start states: the start anchor alone, or every pool track except the end anchor (unless the target is one track), keeping the best `beamWidth`.
2. For each state, list placeable tracks (not the anchors; repeats only if allowed and at least `minGapTracks` apart). At the last position only the end anchor is offered. If the missing required tracks exceed the remaining free slots, only missing required tracks are offered.
3. Keep each state's best `branchFactor` options, de-duplicate, keep the best `beamWidth` overall. Ties break by track ID, so results are reproducible.
4. If the beam deadline passes, each state is completed greedily (best step score each time).

### 12.3 Local improvement

Each of the first $\min(\#\text{beam results}, \max(1, \texttt{alternatives}+2))$ beam results is improved by **first-improvement hill climbing** on the full objective $J$. A move is accepted if it lowers $J$ by more than $10^{-9}$; passes repeat until none helps or time runs out. Anchored positions never move.

| Move | When | What |
|---|---|---|
| Swap | always | Exchange two positions |
| Relocate | always | Move one track to a non-adjacent position |
| Replace | `choose_from_pool` | Swap an optional track for one of the 8 unused tracks with the lowest guide cost to its neighbours |
| Remove | pool mode with a duration target | Drop an optional track (only when the plan has 3 or more) |
| Add | pool mode with a duration target | Insert one of the 4 best-fitting unused tracks between two neighbours |

Every move is re-scored through `evaluateSequence`, including cue assignment, because directional costs make reversal shortcuts unsafe.

### 12.4 Proposal and alternatives

The improved plans are sorted by $J$. The best is the **proposal**. Another plan becomes an alternative (up to `alternatives`) if it is close, $J \le 1.3\,J_\text{proposal} + 0.1$, and different from every plan already chosen: its share of shared directed adjacent pairs is below 0.75.

```math
\mathrm{sim}(P, Q) = \frac{\lvert \text{pairs}(P) \cap \text{pairs}(Q)\rvert}{\max(\lvert\text{pairs}(P)\rvert, \lvert\text{pairs}(Q)\rvert)}
```

### 12.5 Time budget

With $B = \max(200, \texttt{timeBudgetMs})$: beam search stops at $0.3B$; the rest is shared equally among the plans still to improve (at least 20 ms each). The exact solver has its own deadline of $\max(500, B)$ after it starts, so total runtime can exceed $B$.

Code: `web/src/lib/planner/search.ts` → `beamSearch`, `stepScore`, `completeGreedily`, `improve`, `sequenceSimilarity`; `web/src/lib/planner/evaluate.ts` → `PlanningContext.bestPairCost`.

## 13. Exact solver

For `use_all` requests whose pool has 1 to 8 tracks (`EXACT_LIMIT = 8`), every ordering of the non-anchored tracks is generated with Heap's algorithm (at most $8! = 40{,}320$) and scored with the full objective. It returns `null` if it times out. The result is used only to report how far the heuristic is from the optimum:

```math
\text{gap} = \max\!\left(0,\ \frac{J_\text{proposal} - J_\text{exact}}{\max(J_\text{exact}, 10^{-9})}\right)
```

The proposal is not replaced by the exact order. The tests require gap < 0.25 on a six-track crate.

Code: `web/src/lib/planner/exact.ts` → `exactOrder`; `web/src/lib/planner/index.ts` → `planSet`.

## 14. Randomness and reproducibility

The planner itself has no random choices: every sort breaks ties by track ID, and beam search, local search and the exact solver are deterministic. The only randomness is the **Random order** baseline, which shuffles with Fisher–Yates driven by mulberry32 seeded with `seed XOR 0x9E3779B9`. A plan can still differ between runs when the time budget cuts beam or local search at a different point on a slower or busier machine.

Code: `web/src/lib/planner/rng.ts` → `createRng`, `shuffle`.

## 15. Baselines

To show whether the planner helps, the same tracks as the proposal (de-duplicated) are ordered four simple ways and scored with the same objective and constraints. A baseline that breaks an anchor keeps its violations instead of changing the task.

| Baseline | Order |
|---|---|
| Random order | Seeded shuffle |
| BPM ascending | By BPM, unknown last, then ID |
| Camelot walk | Greedy nearest next by $\text{compareKeys cost} + 0.01\,\lvert\ln(\text{BPM}_A/\text{BPM}_B)\rvert$ (0.005 if a BPM is missing; key cost 0.5 if a key is missing) |
| Greedy nearest next | Greedy by `bestPairCost` |

The two greedy baselines open with the start anchor, or else the lowest-energy track (unknown energy counts as 11), and close with the end anchor.

Code: `web/src/lib/planner/baselines.ts` → `runBaselines`, `greedyOrder`, `harmonicCost`.

## 16. Metrics

Each evaluated plan reports:

| Metric | Meaning |
|---|---|
| `trackCount`, `totalSeconds` | Tracks and planned playback time $T$ |
| `transitionCost` | Mean, median, worst and the worst transition's index |
| `reviewNeededShare` | Share of transitions flagged for review |
| `arc` | RMSE, coverage $\kappa$, whether an arc was set |
| `diversity` | Artist and remix spacing violations, all style tags present, longest same-primary-style run |
| `durationErrorSeconds` | $\varepsilon$, or `null` without a target |
| `missingEvidence` | Unique tracks without a usable key, BPM, or energy; and the number of items whose entry is `reviewed` or `full_track` |

The result also carries `runtimeMs`, `evaluations` (number of full sequence evaluations), `warnings`, the exact gap, and the pool sizes (candidates, considered, target count).

Code: `web/src/lib/planner/types.ts` → `PlanMetrics`, `PlanResult`; `web/src/lib/planner/evaluate.ts` → `evaluateSequence`.

## 17. Saving, editing and export

**Create.** The form posts the request as JSON in a `payload` field. `createPlan` validates it with `createPlanSchema` (name 1–120 characters, optional crate), loads the user's tracks, runs `planSet` synchronously, inserts a `plans` row with `request` and the full `result` JSON, then inserts one `plan_items` row per proposal item (position, occurrence ID, track, entry and exit option IDs, play start/end, elapsed start). Option IDs are text so fallback windows (`<trackId>:fallback-entry`) fit. See [data-and-storage.md](data-and-storage.md) for the tables.

**Edit order.** `saveEditedOrder` re-scores a hand-made order with `evaluateEditedOrder` against the stored request and the current library, replaces the proposal, and rewrites the items atomically through the `replace_plan_items` database function (which also marks the plan `edited`). It records a `manual_reorder` annotation with the old and new order, both objective totals, and the user's reason.

**Adopt an alternative.** `adoptAlternative` swaps the chosen alternative with the proposal and records `adopt_alternative`.

**Judge a transition.** `judgeTransition` records a pair annotation (`works`, `needs_adjustment`, `clash`) with the option IDs. These judgments are stored for future evaluation and weight fitting; the planner does not read them yet.

**Export.** `GET /plans/{id}/export?format=json` returns `{name, request, result}`. Any other format returns CSV of the proposal, one row per track, CRLF line endings, quoted where needed:

`position, title, artist, elapsed_start_s, play_start_s, play_end_s, entry, entry_status, exit, exit_status, energy, target_energy, next_transition, overlap_s, tempo_adjust_pct, transition_cost, review_needed, explanation`

The transition columns describe the move from that row to the next, so they are empty on the last row. The file name is a slug of the plan name.

Code: `web/src/app/actions/plans.ts` → `createPlan`, `saveEditedOrder`, `adoptAlternative`, `judgeTransition`, `deletePlan`; `web/src/app/(app)/plans/[planId]/export/route.ts` → `GET`; `web/src/lib/planner/index.ts` → `evaluateEditedOrder`.

## Limitations and open questions

- **Weights are unvalidated.** Every weight, cost table and threshold is a declared hypothesis. The research plan calls for held-out listening judgments before any are treated as established ([playlist-engine-evaluation.md](../research/playlist-engine-evaluation.md)).
- **Whole-track features.** Key, BPM and energy are track-level. The planner does not use local key or energy inside the overlap region, or beat phase. Phrase positions reach it only through where cue regions start (analyzer and Rekordbox suggestions sit on 8-bar phrases); the planner itself does not check that two regions line up on bars, and the 32/16/8/4-beat lengths are assumptions.
- **Energy comparability.** The arc and energy step assume energy values are comparable across tracks on the 1–10 scale. A library can mix user ratings with model estimates that are ranked within the library and not calibrated against those ratings, and the planner does not tell them apart.
- **`maxTempoAdjustPct = 0` produces `NaN`.** The schema allows 0. Two tracks at exactly the same tempo then give $p/L = 0/0$, which the clamp does not catch, so the transition cost and the objective become `NaN`.
- **`use_all` with more than `maxCandidates` tracks.** Pruning drops tracks but the target count is the pruned pool size, so the plan always misses supplied tracks and pays a `count` penalty. Default `maxCandidates` is 160; the schema allows up to 5000 candidates.
- **The seed only affects the Random baseline.** It is shown as a search setting but does not change the proposal.
- **Key lock and transition type disagree.** With key lock off, the blend decision compares the written keys while the harmonic cost compares the transposed key, so a pair can be suggested as a long blend while its harmonic cost is 1. Rounding a 0.55-semitone shift to a whole semitone also makes the harmonic cost jump sharply.
- **Approved estimated cues stay `estimated`.** A cue with provenance `estimate` and status `approved` still costs 0.35 and flags review, while pruning counts it as complete. It is unclear whether approval should make a cue `reviewed`.
- **Count versus duration.** With both a count and a duration target, the count is not checked, and add/remove moves can change the track count.
- **Stale data after edits.** An edited proposal keeps the original alternatives, baselines and exact gap, and is re-scored against the library as it is now, not as it was when planned.
- **Plan creation is not atomic.** `createPlan` inserts the plan and its items in two statements; if the second fails, the plan exists without items (the message says so). Edits use the atomic `replace_plan_items`.
- **Runtime.** Planning runs synchronously in the server action, and the exact solver runs outside the time budget. Anchors can never repeat even when repeats are allowed, because search never offers them as ordinary options.
- **Heuristic, not proof.** If the proposal violates a constraint, that does not prove no valid plan exists (the warning says so). The exact solver only covers fixed crates of up to 8 tracks and is not used to replace the proposal.
- **Small details.** `missingEvidence.reviewedCues` counts reviewed entries, not missing ones. The artist tokenizer splits on `feat`/`ft` at a word start, so "featuring" leaves a stray "uring" token and names starting with "ft" are split.
