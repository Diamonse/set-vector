# Energy estimate

The web app gives every analyzed track that has no energy rating of its own a 1–10 **energy estimate**. Five measurements from the browser analysis and the track's BPM are each ranked against the other analyzed tracks in the same library, pulled towards a fixed reference range, and combined with fixed weights. The model is named `library-percentile-v1` and is marked experimental: the weights and ranges are hypotheses, and the score is relative to the library, so adding or removing tracks moves other tracks' scores. A rating the user entered or imported is never replaced.

The Python CLI has no energy estimate.

## Pipeline at a glance

1. **Measure** (browser, during analysis): loudness of the busiest sections, onset rate, mean bass ratio and mean spectral centroid are stored as `energyFeatures` in the analysis result.
2. **Gather** (server): load every track's BPM and the energy inputs from its latest analysis. Older analyses without `energyFeatures` fall back to values derived from their stored series.
3. **Rank** each input against the library with a mid-rank percentile.
4. **Shrink** each rank towards a fixed reference range, weighted as if it were eight tracks of evidence.
5. **Combine** the positions with fixed weights into $1 + 9 \times$ the weighted mean.
6. **Write** the result only onto tracks whose energy is empty or was written by the model, through a database function that enforces the same rule.

Code: `web/src/lib/analysis/energy-features.ts` → `energyFeatures`; `web/src/lib/energy/score.ts` → `scoreLibrary`; `web/src/lib/data/energy.ts` → `loadLibraryEnergy`, `refreshEnergyEstimates`.

---

## 1. Measured inputs

Every value here is comparable between tracks. That is why onset activity is a count rather than an amplitude: the onset strength envelope is normalized per track, so a quiet track and a loud one both peak at 1.0, which says nothing about how busy either is.

| Field | Definition | Unit |
|---|---|---|
| `loudSectionLufs` | 90th percentile of the BS.1770 short-term loudness series (3 s windows at 1 s steps; gated windows below −70 LUFS are left out) | LUFS |
| `integratedLufs`, `loudnessRangeLu` | Copied from the loudness stage (kept for fallbacks and display, not scored) | LUFS, LU |
| `onsetRate` | Detected onsets per second of non-silent audio (below) | onsets/s |
| `bassRatio` | Mean over frames of the share of spectral power at or below 250 Hz | 0–1 |
| `centroidHz` | Mean spectral centroid | Hz |

The 90th percentile of short-term loudness measures how loud the track gets in its main sections. Integrated loudness would be pulled down by a long quiet intro or breakdown, which DJ tracks often have. The loudness stage is described in [key-loudness-structure.md](key-loudness-structure.md); bass ratio and centroid in [audio-features-and-tempo.md](audio-features-and-tempo.md).

Values are rounded on save: loudness to 0.01 LU, onset rate to 0.001, bass ratio to 4 decimals, centroid to 0.1 Hz. `ENERGY_FEATURES_VERSION` is 1. Adding the inputs raised the web extractor version to 2 (phrase-aligned cues later raised it to 3).

Code: `web/src/lib/analysis/energy-features.ts` → `energyFeatures`, `percentile`.

### 1.1 Onset rate

**What and why.** "How much is happening" is a large part of perceived energy: a busy drum pattern feels more energetic than a sustained pad at the same loudness. The onset rate counts note and drum attacks per second.

**Steps.**

1. Take the full-band onset strength envelope (positive spectral flux, one value per 512-sample hop, so $H = 512/22050 \approx 23.2$ ms).
2. Scale it by its **98th percentile** instead of its maximum and clip at 1: $e_i = \min(1, o_i / P_{98}(o))$. One very loud transient then does not shrink every other onset below the threshold.
3. Pick peaks with the rules of `librosa.util.peak_pick`, as `onset_detect` uses them. Frame $i$ is an onset when all of these hold:
   - $e_i > 0$ and no frame within ±`PRE_MAX`/`POST_MAX` is larger;
   - $e_i \ge \bar e_{[i-a,\ i+a]} + \delta$, where the mean is over ±`PRE_AVG`/`POST_AVG` frames;
   - more than `WAIT` frames have passed since the previous onset.
4. Remove long silences from the duration. A frame is silent when its RMS is at most $\max(10^{-6},\ 10^{-3} \cdot P_{95}(\text{RMS}))$, i.e. more than 60 dB below the track's loud frames. Only silent runs of at least 1 s are removed, so the gaps between hits still count.
5. Rate $= \text{onsets} / (\text{active frames} \times H)$.

| Constant | Seconds | Frames at $H \approx 23.2$ ms |
|---|---|---|
| `PRE_MAX_S`, `POST_MAX_S` | 0.03 | 1 |
| `PRE_AVG_S`, `POST_AVG_S` | 0.10 | 4 |
| `WAIT_S` | 0.03 | 1 (so onsets are at least 2 frames, ~46 ms, apart) |
| `DELTA` | 0.07 (on the 0–1 envelope) | — |
| `MIN_SILENCE_S` | 1 | 43 |

Frame counts are `max(1, round(seconds / H))`. Fewer than 8 frames gives `null`; an all-zero envelope or an entirely silent track gives 0.

Code: `web/src/lib/analysis/energy-features.ts` → `onsetRate`.

## 2. Gathering the library

`loadLibraryEnergy` reads every track (`bpm`, `energy`, `energy_source`, `energy_model`) and every analysis, pages of 1000 rows each, and keeps the newest analysis per track. For each track the inputs are:

| Input | Source, in order of preference |
|---|---|
| `loudness` | `energyFeatures.loudSectionLufs` → 90th percentile of the stored `loudness.shortTerm` series (older analyses only) → `energyFeatures.integratedLufs` → `loudness.integratedLufs` |
| `onsetRate` | `energyFeatures.onsetRate` only |
| `tempo` | the track's `bpm` column, so a corrected BPM is used |
| `bassRatio` | `energyFeatures.bassRatio` → `summary.meanBassRatio` |
| `brightness` | `energyFeatures.centroidHz` → `summary.meanCentroidHz` |

A track with no analysis has no loudness and gets no estimate. Tracks whose latest analysis predates `energyFeatures` are listed in `needsReanalysis`. The library page shows how many there are, and the track page says that analyzing the file again adds drum activity to the estimate.

The stored short-term series is rounded to 0.1 LU, so the derived loudness of an older analysis can differ from a fresh one by up to about 0.05 LU.

Code: `web/src/lib/data/energy.ts` → `loadLibraryEnergy`.

## 3. Scoring

The **population** is the tracks that have a loudness value. Every input is ranked within the population's values for that input, ignoring missing ones.

### 3.1 Mid-rank percentile

For a value $v$ in a sorted population of $n$ values (which includes $v$ itself), with $b$ values strictly below and $q$ equal values:

```math
r(v) = \frac{b + \max(0,\ q - 1)/2}{n - 1}, \qquad r = 0.5 \text{ when } n \le 1
```

The track is left out of its own comparison, so a single track sits at 0.5, the lowest value at 0 and the highest at 1. Ties share the middle of their range.

### 3.2 Shrinking towards a reference range

In a library of five tracks, the quietest of them may still be loud. To keep small libraries sensible, each rank is blended with a fixed reference position:

```math
\text{ref}(v) = \operatorname{clamp}_{[0,1]}\!\left(\frac{v - \text{low}}{\text{high} - \text{low}}\right), \qquad
p = \frac{(n-1)\, r(v) + k\, \text{ref}(v)}{(n-1) + k}, \quad k = 8
```

$k$ (`PRIOR_WEIGHT`) is the number of tracks of library evidence that count as much as the reference range. With 8 other tracks the two weigh equally; with 100 the library rank has 93 % of the weight.

| Input | Label in the UI | Weight $w$ | Reference low | Reference high | Unit |
|---|---|---|---|---|---|
| `loudness` | Loudness of the busiest sections | 0.35 | −20 | −5 | LUFS |
| `onsetRate` | Drum and note activity | 0.25 | 1 | 7 | onsets/s |
| `tempo` | Tempo | 0.15 | 80 | 150 | BPM |
| `bassRatio` | Bass weight | 0.15 | 0.15 | 0.70 | share |
| `brightness` | Brightness | 0.10 | 800 | 3500 | Hz |

### 3.3 Combining

An estimate needs loudness and at least `MIN_INPUTS = 3` inputs. Weights are renormalized over the available inputs $A$:

```math
w'_k = \frac{w_k}{\sum_{j \in A} w_j}, \qquad
E = \operatorname{round}_{0.1}\!\left(1 + 9 \sum_{k \in A} w'_k\, p_k\right)
```

Each input's **points** are $9\, w'_k\, p_k$, its share of the score above the minimum of 1. The track page lists every input's value, percentile, weight and points, so the score can be explained and later compared with the user's own ratings. Without enough inputs the estimate is `null` with a reason ("No loudness measurement; analyze the audio file." or "Too few measurements for an estimate.").

Code: `web/src/lib/energy/score.ts` → `midRank`, `scoreLibrary`, `INPUTS`.

### Worked example

Five analyzed tracks. Track X has loudness −8 LUFS, onset rate 4.0/s, 126 BPM, bass ratio 0.45 and centroid 2000 Hz. The four others:

| Track | Loudness | Onsets/s | BPM | Bass | Centroid |
|---|---|---|---|---|---|
| a | −12 | 2.0 | 118 | 0.30 | 1500 |
| b | −10 | 5.0 | 122 | 0.40 | 2500 |
| c | −9 | 3.0 | 124 | 0.55 | 1800 |
| d | −6 | 6.0 | 120 | 0.60 | 2200 |

With $n - 1 = 4$ others and $k = 8$, $p = (4r + 8\,\text{ref})/12$:

| Input | Below X | $r$ | ref | $p$ | $w'$ | Points |
|---|---|---|---|---|---|---|
| Loudness | 3 of 4 | 0.75 | $(−8+20)/15 = 0.800$ | 0.7833 | 0.35 | 2.467 |
| Onset rate | 2 of 4 | 0.50 | $(4−1)/6 = 0.500$ | 0.5000 | 0.25 | 1.125 |
| Tempo | 4 of 4 | 1.00 | $(126−80)/70 = 0.657$ | 0.7714 | 0.15 | 1.041 |
| Bass | 2 of 4 | 0.50 | $(0.45−0.15)/0.55 = 0.545$ | 0.5303 | 0.15 | 0.716 |
| Brightness | 2 of 4 | 0.50 | $(2000−800)/2700 = 0.444$ | 0.4630 | 0.10 | 0.417 |

$E = 1 + 5.766 = 6.766 \to$ **6.8**. On its own (a library of one), every rank is 0.5, every $p$ equals its reference position, and X scores 6.7. Without onset rate and bass ratio, the remaining weights become $0.35/0.6 = 0.583$, $0.15/0.6 = 0.25$ and $0.10/0.6 = 0.167$, and X scores 7.5, because its strongest inputs now carry all the weight.

These numbers were produced by running `scoreLibrary`.

## 4. Writing estimates

**Who owns a value.** `tracks.energy_model` names the model that wrote the current energy value. It is `null` for a value the user typed or imported. The rules:

- A track is **model-owned** when its energy is empty or `energy_model` is set. Only model-owned tracks are written.
- A new estimate is written with `energy_source = 'estimate'` and `energy_model = 'library-percentile-v1'`. A `null` estimate clears an earlier model value (energy, source and model all become `null`).
- A write is skipped when nothing changed: both values `null`, or the stored value is within 0.05 of the new one and was written by the same model.

**Database enforcement.** Migration `20261002000000_energy_estimates.sql` adds:

| Object | Rule |
|---|---|
| Column `energy_model` | text, at most 64 characters |
| Check `tracks_energy_model` | `energy_model` may be set only when `energy` is set and `energy_source = 'estimate'` |
| Trigger `tracks_clear_energy_model` | Any other change to `energy` or `energy_source` (a form edit, an import) sets `energy_model` to `null`, which hands the value to the user |
| Function `apply_energy_estimates(estimates jsonb, model text)` | `security invoker`. Sets a transaction-local flag `setvector.energy_model_write` so the trigger leaves its own writes alone, then updates only the caller's tracks whose energy is empty or model-written, and returns the number of rows changed |

The application sends updates in batches of 1000. The trigger function's `execute` right is revoked from every role; the RPC is granted to `authenticated` only.

A consequence: clearing the energy field on the track form makes the track model-owned again, so the next refresh fills in an estimate.

**When estimates are refreshed.** Because scores are library-relative, the whole library is rescored, not only the track that changed:

| Event | Code |
|---|---|
| At least one analysis saved | `saveAnalyses` |
| A track's form saved (a tempo edit or a cleared energy value changes the estimates) | `updateTrack` |
| A track deleted | `deleteTrack` |
| **Library › Recalculate energy** | `recalculateEnergy` |

Code: `web/src/lib/data/energy.ts` → `refreshEnergyEstimates`; `web/src/app/actions/energy.ts` → `recalculateEnergy`; `web/supabase/migrations/20261002000000_energy_estimates.sql`.

## 5. Where the estimate is used

The planner reads `tracks.energy` whatever its source, so model estimates feed the energy-step cost and the energy arc exactly as user ratings do ([set-planner.md](set-planner.md)). Library filters, sorting, the energy histogram on the home page and the planner's pruning bands all use the same column. The home page counts model-written values separately as "estimated energy".

## Limitations and open questions

- **Uncalibrated.** The weights (0.35, 0.25, 0.15, 0.15, 0.10), reference ranges and prior weight 8 are hypotheses. They are not fitted to listener judgments, and the score is not a calibrated measure of perceived energy. The per-input points are kept so the estimate can be compared with the user's ratings later.
- **Library-relative.** The same track can score differently in two libraries, and a score changes when other tracks are added, analyzed or deleted. A saved plan's stored scores reflect the energies at planning time; editing the plan re-scores it with the current values.
- **Not refreshed after imports.** CSV and Rekordbox imports do not trigger a refresh. A Rekordbox import that fills an empty BPM on an analyzed track leaves its estimate stale until the next refresh event or a manual recalculation.
- **Whole-track values.** Every input is a whole-track summary. Energy inside a specific entry or exit region, or the build and drop shape within a track, is not measured.
- **Tempo as energy.** Tempo is scored on its absolute value, so a half-time track noted at 70 BPM ranks as slow even when it feels as intense as a 140 BPM track.
- **Older analyses** have no onset rate and use a loudness derived from the rounded short-term series. Their estimates use four inputs until the file is analyzed again.
- **Not in Python.** The CLI computes no energy inputs and no estimate.
