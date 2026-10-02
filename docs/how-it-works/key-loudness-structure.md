# Key, loudness, and structure

The web app estimates a track's musical key, measures its loudness, finds likely section boundaries, and suggests an entry (intro) and exit (outro) region for mixing. All four steps are deterministic signal processing that runs in the browser's analysis worker; none uses a trained model. The Python CLI does not implement any of them yet.

Every output is saved as an estimate. A key or cue the user has reviewed is never overwritten by a later analysis.

## Pipeline at a glance

1. Resample the mono mix to 22,050 Hz (shared with rhythm analysis; see [audio-features-and-tempo.md](audio-features-and-tempo.md)).
2. Build a **chromagram**: the strength of each of the 12 pitch classes in each frame.
3. Sum the chromagram over the track and correlate it with 24 **key templates**. The best match is the key, and the gap to the runner-up decides whether it is `estimated` or `uncertain`.
4. Measure **loudness** on the original channels with ITU-R BS.1770-4 (integrated LUFS, loudness range, short-term curve, sample peak).
5. Build one feature vector per beat (chroma, loudness, brightness, bass), compute a **novelty curve** from their self-similarity, and keep its peaks as **section boundaries**.
6. Suggest one **entry** and one **exit** cue region from the beat grid and the boundaries, and estimate the key inside each region.
7. On save, write key and tempo onto the track only if the user has not reviewed them, and insert the cue regions as `pending` for review.

Code: `web/src/lib/analysis/analyze.ts` → `analyzeAudio` (stages `key`, `loudness`, `structure`).

---

## 1. Chromagram

**What and why.** A key is a set of preferred pitches, so the first step measures how much of each pitch class (C, C#, … B, ignoring octave) the audio contains over time.

**Inputs → outputs.** Mono `Float32Array` at 22,050 Hz → a `frames × 12` matrix, plus a per-frame `voiced` flag.

| Constant | Value | Meaning |
|---|---|---|
| `CHROMA_N_FFT` | 4096 samples | Window length, ≈ 185.8 ms; frequency resolution $22050/4096 \approx 5.38$ Hz |
| `CHROMA_HOP` | 2048 samples | Step between frames, ≈ 92.9 ms |
| `CHROMA_F_MIN` | 65 Hz | Ignore content below roughly C2 (kick and sub-bass) |
| `CHROMA_F_MAX` | 2100 Hz | Ignore content above roughly C7 (hats, air, harmonics) |
| Window | periodic Hann | |

**Mapping FFT bins to pitch classes.** Each FFT bin $k$ has frequency $f_k = k \cdot f_s / N$. Its fractional MIDI note number is

```math
m_k = 69 + 12 \log_2\!\left(\frac{f_k}{440}\right)
```

The bin is assigned to the pitch class of the nearest note, $p_k = \operatorname{round}(m_k) \bmod 12$, with a triangular weight that is 1 when the bin sits exactly on a note and 0 halfway between two notes:

```math
w_k = 1 - 2\,\lvert m_k - \operatorname{round}(m_k) \rvert
```

Bins with $w_k \le 0$ are dropped.

**Per-frame chroma.** For frame $t$ with FFT $X_t$:

```math
C_t[p] = \sqrt{\sum_{k:\,p_k = p} w_k \,\lvert X_t[k] \rvert^2}, \qquad
\hat C_t[p] = \frac{C_t[p]}{\max_q C_t[q]}
```

The square root keeps tonal peaks above broadband noise but limits how much a single loud note can pull the result. Dividing by the frame's maximum makes every frame count equally, so loud and quiet passages vote the same.

**Voiced frames.** Each frame's raw energy is $E_t = \frac{1}{N}\sum_i s_i^2$, measured before windowing. A frame is *voiced* (carries pitch information) when

```math
E_t > 10^{-4} \cdot E_{(90\%)} \quad\text{and}\quad E_t > 10^{-10}
```

Here $E_{(90\%)}$ is the energy at the 90th percentile of all frames, taken by sorted index without interpolation. $10^{-4}$ is 40 dB, so frames more than 40 dB below the loud parts of the track are treated as silence.

Code: `web/src/lib/analysis/key.ts` → `chromagram`.

## 2. Key estimate

**What and why.** This is the Krumhansl–Schmuckler method. Listening experiments produced a "key profile": how well each of the 12 scale degrees fits a major or a minor key. The track's pitch-class profile is compared with that template rotated to each of the 12 possible tonics, and the closest match wins.

**Track profile.** Sum the normalized chroma over voiced frames in the region $[t_0, t_1)$. A frame's time is $f \cdot \text{hop}/f_s$, which is the start of its window.

```math
P[p] = \sum_{t \in \text{voiced},\; t_0 \le \text{time}(t) < t_1} \hat C_t[p]
```

**Templates.** The default is Krumhansl–Kessler. Temperley's profile is also implemented but nothing selects it. Index 0 is the tonic.

| Degree | 1 | ♭2 | 2 | ♭3 | 3 | 4 | ♯4 | 5 | ♭6 | 6 | ♭7 | 7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| KK major | 6.35 | 2.23 | 3.48 | 2.33 | 4.38 | 4.09 | 2.52 | 5.19 | 2.39 | 3.66 | 2.29 | 2.88 |
| KK minor | 6.33 | 2.68 | 3.52 | 5.38 | 2.60 | 3.53 | 2.54 | 4.75 | 3.98 | 2.69 | 3.34 | 3.17 |

**Scoring 24 keys.** For each tonic $\tau \in \{0..11\}$ (0 = C) and mode $\mu \in \{\text{major}, \text{minor}\}$, rotate the template so its tonic lands on $\tau$, then take the Pearson correlation:

```math
T_{\tau,\mu}[p] = T_\mu[(p - \tau) \bmod 12], \qquad
r_{\tau,\mu} = \frac{\sum_p (P[p]-\bar P)(T_{\tau,\mu}[p]-\bar T)}{\sqrt{\sum_p (P[p]-\bar P)^2 \,\sum_p (T_{\tau,\mu}[p]-\bar T)^2}}
```

Correlation ignores the overall scale of $P$, so only the *shape* of the pitch distribution matters. The keys are sorted by $r$. The best is the estimate, and the top 5 are kept for display.

**Abstaining.** The method always produces a best key, so three checks decide whether to trust it. If any check fails, the status becomes `uncertain` and a plain-language reason is recorded:

| Check | Threshold | Catches |
|---|---|---|
| Best correlation $r_1$ | $\ge 0.5$ (`MIN_KEY_CORRELATION`) | Atonal, percussive, or noisy material that matches no key well |
| Margin $r_1 - r_2$ | $\ge 0.02$ (`MIN_KEY_MARGIN`) | Near ties, usually relative major/minor or keys a fifth apart |
| Voiced share | $\ge 0.2$ (`MIN_TONAL_FRAMES_SHARE`) | Regions that are mostly silence |

If no frame is voiced, tonic and mode are `null`. The code comments call all three thresholds provisional, to be set from reviewed keys. The margin is an algorithm diagnostic, **not** a probability that the label is right.

**Region keys.** After the cue regions are chosen (section 5), `estimateKey` runs again on each region alone. A key change between intro and outro shows up as different region keys. Region keys are displayed and stored in the full analysis result but are not written onto the track.

Code: `web/src/lib/analysis/key.ts` → `rankKeys`, `estimateKey`.

### Worked example

Suppose the summed profile is strongest on A, C, E and G, weaker on D and F, and near zero on C# and G#. The A-minor template rotated to $\tau = 9$ puts its large weights (6.33 tonic, 5.38 minor third, 4.75 fifth) on A, C and E, giving a high $r$. C major ($\tau = 0$) puts 6.35, 4.38 and 5.19 on C, E and G, which share most of the same notes, so its $r$ is close behind. A margin like 0.015 would mark the result `uncertain` with the reason "the top two keys differ by only 0.015". This relative major/minor tie is the most common ambiguity.

## 3. Camelot notation and key handling

**Camelot code.** DJs write keys as positions on the Camelot wheel: numbers 1–12 go around the circle of fifths, `A` is minor and `B` is major. Moving one step on the wheel is a perfect fifth, i.e. 7 semitones. Since $7 \cdot 7 = 49 \equiv 1 \pmod{12}$, multiplying by 7 converts between semitones and fifths both ways:

```math
n = (7\tau + c) \bmod 12,\quad n = 0 \mapsto 12, \qquad c = \begin{cases} 8 & \text{major (B)} \\ 5 & \text{minor (A)} \end{cases}
```

```math
\tau = 7\,(n - c) \bmod 12
```

Check: C major ($\tau = 0$) → $8$ → **8B**. A minor ($\tau = 9$) → $(63 + 5) \bmod 12 = 8$ → **8A**. Relative major and minor share a number.

**Parsing.** `parseKey` accepts Camelot codes (`8A`, `08a`) and note names (`Am`, `A minor`, `C#m`, `Bb major`, `E♭ min`, `F#`). A bare note means major, and a capital `M` suffix also means major. Anything else returns `null`. Library import (`key`, `camelot` or `initial_key` columns) and the manual track form both use it. A key typed into the form is promoted to `reviewed` if its status was `unknown` or `not_meaningful`.

**When a key is usable.** `usableKey` returns a key only when its status is `estimated` or `reviewed`. Keys that are `unknown`, `uncertain` or `not_meaningful` abstain from harmonic comparison instead of guessing.

**Comparing two keys.** `compareKeys` measures the distance between two Camelot numbers as $s = \min(|a-b|, 12-|a-b|)$ and assigns a ranking cost. The planner decides how heavily this cost counts (see [set-planner.md](set-planner.md)):

| Relation | Condition | Cost |
|---|---|---|
| same | $s = 0$, same letter | 0 |
| adjacent | $s = 1$, same letter | 0.15 |
| relative | $s = 0$, different letter | 0.20 |
| diagonal | $s = 1$, different letter | 0.45 |
| two_steps | $s = 2$, same letter | 0.50 |
| distant | otherwise | $\min(1,\; 0.6 + 0.1(s-2) + 0.05\cdot[\text{letters differ}])$ |

`transposeKey` shifts the tonic by whole semitones. It models playback with pitch changed and key lock off.

Code: `web/src/lib/domain/camelot.ts` → `toCamelot`, `fromCamelot`, `parseKey`, `usableKey`, `compareKeys`, `transposeKey`.

## 4. Loudness (ITU-R BS.1770-4 / EBU R128)

**What and why.** LUFS is the broadcast standard for loudness as people hear it. It is useful for level-matching and for spotting quiet or heavily compressed masters. The code comments state that it is a standardized level, **not** a model of perceived energy.

**Inputs → outputs.** The original decoded channels at their native sample rate (not the 22,050 Hz mono mix) → integrated loudness (LUFS), loudness range (LU), sample peak (dBFS), and a short-term loudness curve at 1 s steps.

**K-weighting.** Each channel passes through two biquad filters:

- a high-shelf of about +4 dB above roughly 1.7 kHz, modelling the head's acoustic effect;
- a high-pass at about 38 Hz (the "RLB" stage), removing sub-bass the ear barely hears.

The coefficients are computed for the actual sample rate from libebur128's analogue prototypes, so 44.1 kHz and 48 kHz files are both handled correctly:

| Stage | $f_0$ (Hz) | $Q$ | Gain |
|---|---|---|---|
| Shelf | 1681.974450955533 | 0.7071752369554196 | 3.999843853973347 dB |
| High-pass | 38.13547087602444 | 0.5003270373238773 | — |

With $K = \tan(\pi f_0 / f_s)$, $V_h = 10^{G/20}$, $V_b = V_h^{0.4996667741545416}$, and $a_0 = 1 + K/Q + K^2$, the shelf coefficients are $b_0 = (V_h + V_b K/Q + K^2)/a_0$, $b_1 = 2(K^2 - V_h)/a_0$, $b_2 = (V_h - V_b K/Q + K^2)/a_0$, $a_1 = 2(K^2-1)/a_0$, $a_2 = (1 - K/Q + K^2)/a_0$. The high-pass uses $b = (1, -2, 1)$ with the same $a_1, a_2$ form.

**Block power and LUFS.** For a window of $L$ samples, sum the K-weighted mean-square power over channels, each multiplied by its channel weight $G_c$:

```math
z = \sum_c G_c \cdot \frac{1}{L} \sum_{i \in \text{window}} y_c[i]^2, \qquad \text{LUFS}(z) = -0.691 + 10 \log_{10} z
```

$G_c = 1$ for mono, stereo and up to three front channels. For 5+ channels, the last two (surrounds) get 1.41, and channel index 3 of a 6-channel file (the LFE) gets 0. Prefix sums of squares make each window $O(1)$.

**Integrated loudness** uses 400 ms blocks every 100 ms (75 % overlap), with two gates:

1. Absolute gate: drop blocks at or below −70 LUFS (silence).
2. Relative gate: $\Gamma_r = \text{LUFS}(\overline{z}_{\text{abs}}) - 10$. Drop blocks at or below $\Gamma_r$, so quiet breakdowns do not drag the average down.

```math
L_I = \text{LUFS}\!\left(\overline{z}\ \text{over blocks passing both gates}\right)
```

Powers are averaged *before* converting to dB, as the standard requires.

**Short-term loudness and loudness range (EBU Tech 3342).** Short-term loudness uses 3 s windows every 1 s. Values at or below −70 LUFS are stored as `null`. The loudness range takes the short-term values above −70 LUFS, applies a −20 LU relative gate the same way, and measures the spread of what remains:

```math
\text{LRA} = Q_{95\%} - Q_{10\%}
```

The percentiles are linearly interpolated. At least two values are required.

**Sample peak.** $20 \log_{10} \max |x|$ over all channels and samples. This is *sample* peak, not oversampled *true* peak, so inter-sample overs are not detected.

Code: `web/src/lib/analysis/loudness.ts` → `kWeighting`, `measureLoudness`.

## 5. Section boundaries

**What and why.** Dance music changes in blocks: a breakdown strips the drums, a drop brings back the bass. Boundaries are estimated as the moments where "what the music sounds like" changes most, using Foote's checkerboard novelty. The code comments state that a boundary is where the music changes. It is not a verified phrase, drop, or safe mix point.

**Units.** If the beat grid has at least $2 \times 16 = 32$ beats, each unit is one beat, from beat $i$ to beat $i+1$. The final unit's end is extrapolated by one beat interval and capped at the duration. Otherwise the fallback is fixed 0.5 s units. With fewer than 32 units, no boundaries are returned.

**Feature vector per unit (15 dimensions).**

| Dims | Feature | Source |
|---|---|---|
| 0–11 | Mean normalized chroma over voiced frames in the unit | section 1. Frame time here is the centre, $(f + 0.5)\cdot\text{hop}/f_s$ |
| 12 | $\log_{10}(\overline{\text{RMS}} + 10^{-6})$ | baseline frames |
| 13 | mean spectral centroid / 1000 (kHz) | baseline frames |
| 14 | mean bass ratio | baseline frames |

The baseline features are described in [audio-features-and-tempo.md](audio-features-and-tempo.md). Non-finite values become 0. Each dimension is then **z-scored** across all units, $v_d \leftarrow (v_d - \mu_d)/\sigma_d$, using the population standard deviation and $\sigma_d = 1$ when it is 0. This gives chroma, loudness and timbre comparable influence.

**Self-similarity.** Cosine similarity between units $a$ and $b$: $S(a,b) = \dfrac{v_a \cdot v_b}{\lVert v_a\rVert\,\lVert v_b\rVert}$.

**Checkerboard novelty.** At each unit $c$, a $2h \times 2h$ kernel with $h = 16$ beats (`KERNEL_BEATS`) compares the 16 units before $c$ with the 16 after:

```math
N(c) = \max\!\left(0,\; \frac{\sum_{i,j=-h}^{h-1} \operatorname{sign}(i,j)\; g(i,j)\; S(c+i,\,c+j)}{\sum_{i,j} g(i,j)}\right)
```

```math
\operatorname{sign}(i,j) = \begin{cases} +1 & i, j \text{ on the same side of } c \\ -1 & \text{opposite sides} \end{cases}, \qquad
g(i,j) = \exp\!\left(-\frac{(i+\tfrac12)^2 + (j+\tfrac12)^2}{2\sigma^2}\right),\ \sigma = h/2 = 8
```

Intuition: if the past 16 beats resemble each other, the next 16 resemble each other, but the two blocks differ, then the positive quadrants are high, the negative quadrants are low, and $N(c)$ peaks. The Gaussian taper favours units close to $c$. Pairs that fall outside the track are skipped and excluded from the normalization.

**Peak picking.** A unit is a boundary when all of these hold:

- $N(c) > 0$ and $N(c) \ge$ the 90th-percentile value of the curve (by sorted index), so roughly the top 10 % of units qualify;
- $N(c)$ is the maximum within ±8 units (`KERNEL_BEATS / 2`);
- $c$ is at least 8 units from either end.

Boundary strength is $N(c)$ divided by the strongest peak, so it lies in (0, 1].

Code: `web/src/lib/analysis/structure.ts` → `unitFeatures`, `novelty`, `findBoundaries`.

## 6. Entry and exit cue suggestions

**What and why.** These are mix-in and mix-out regions to start reviewing from, each about 32 beats (8 bars of 4/4).

| Constant | Value |
|---|---|
| `REGION_BEATS` | 32 |
| `MIN_REGION_BEATS` | 16 |

**With a beat grid** (at least $32 + 16 = 48$ beats):

- **Entry:** starts at the beat nearest the first downbeat, or at the first beat if no downbeats were detected. It ends 32 beats later, or at the last beat if the track is shorter.
- **Exit:** take the latest boundary that satisfies all of
  - $t \ge 0.6 \cdot \text{duration}$,
  - $t \le \text{duration} - 16 \cdot \overline{\Delta\text{beat}}$, where $\overline{\Delta\text{beat}} = (b_{\text{last}} - b_0)/(n-1)$, so at least 16 beats remain,
  - strength $\ge 0.3$.

  The exit starts at the beat nearest that boundary. If no boundary qualifies, it starts at $\max(\text{entry end},\ n - 1 - 32)$, i.e. the last 32 beats. It ends 32 beats later, capped at the last beat or the duration.

**Without a grid:** the entry is $[0, \ell]$ and the exit is $[\text{duration} - \ell, \text{duration}]$ with $\ell = \min(30\text{ s}, \text{duration}/3)$.

Regions that are empty or extend past the duration are dropped. Times are rounded to milliseconds.

Code: `web/src/lib/analysis/structure.ts` → `suggestCues`.

## 7. Saving results onto a track

The full result, including the key ranking, region keys, loudness curve and boundaries, is stored as JSON in `track_analyses`. Only selected fields are copied onto the track (see [data-and-storage.md](data-and-storage.md)):

| Field | Written when | Otherwise |
|---|---|---|
| BPM and alternatives | the estimate is in [40, 250] and the stored BPM is empty or itself an `estimate` | kept as "tempo (reviewed)" |
| Key tonic, mode, status | the estimate has a tonic and the stored status is `unknown`, `estimated` or `uncertain` | `reviewed` and `not_meaningful` keys are kept |
| Cue regions | they fit inside the stored duration and are not within 0.5 s (start and end) of an existing region of the same kind, approved or rejected | skipped, so a re-analysis never re-suggests a decision the user already made |

New cue regions are inserted with `provenance = estimate` and `review_status = pending`. A warning is raised when the decoded duration differs from the stored duration by more than 1 s, which suggests a different file. An `audio_analysis` annotation records which values were applied and which were kept.

Code: `web/src/lib/analysis/apply.ts` → `planTrackUpdate`, `fittingCues`. `web/src/app/actions/analysis.ts` → `saveAnalyses`.

## Limitations and open questions

- **Single global key.** One key per track, plus one per cue region. Modulations elsewhere in the track are averaged together.
- **Template method, no genre awareness.** Krumhansl–Kessler profiles come from Western tonal listening tests. Modal, drone, or heavily percussive electronic music often fits poorly, and relative major/minor and fifth-related confusions are common. The abstention thresholds (0.5, 0.02, 20 %) have not been calibrated against reviewed keys.
- **Low-frequency resolution.** At 5.38 Hz per bin, semitones below about 90 Hz are only a few bins apart (about 3.9 Hz apart at 65 Hz), so bass notes near the lower limit are smeared across pitch classes. There is no tuning-offset estimation, so material tuned well away from A = 440 Hz is mapped to the wrong bins.
- **Frame-time convention differs.** Key regions use the window start, $f\cdot\text{hop}/f_s$. Structure units use $(f+0.5)\cdot\text{hop}/f_s$. The true window centre is $f\cdot\text{hop}/f_s + N/(2f_s) = (f+1)\cdot\text{hop}/f_s$. The effect is a sub-second shift at region edges.
- **ID3 `TKEY` is read but unused.** `readId3` extracts the tag's key text, but analysis saves only title and artist from tags. A key embedded by other software is not imported through the analyze flow; it can be brought in via CSV/JSON import.
- **Sample peak, not true peak.** Inter-sample overs above 0 dBFS are not detected.
- **Boundaries are not phrases.** Novelty peaks are not snapped to bars or 8/16-bar phrases. The 90th-percentile threshold and the 0.3 strength cut-off for exits are heuristics. Quiet intros and outros with little change may yield no boundary, in which case the exit falls back to the last 32 beats.
- **Not in the Python CLI.** Key, loudness, structure and cue suggestions exist only in the web app. The CLI's analysis covers baseline features and rhythm.
