# Audio features and tempo

This page follows a track from its file bytes to a set of per-frame measurements (loudness, brightness, bass share, onset strength), a tempo estimate, and a list of beats from a classic signal-processing beat tracker. The Python CLI and the web app implement the same pipeline: Python calls librosa for tempo and beats, and the web app has a TypeScript port of those librosa routines, checked against Python output by a parity test. These beats are the *fallback* rhythm candidate; the neural Beat This! candidate, grid fitting, and the final BPM are covered in [rhythm-and-beat-grid.md](rhythm-and-beat-grid.md).

## Pipeline at a glance

1. **Identify** the file by the SHA-256 of its bytes (the asset ID).
2. **Decode** to floating-point samples at the file's native sample rate. Levels are not normalized.
3. **Mix to mono** by averaging channels. Python can optionally keep channels or resample; the web app always mixes to mono at the native rate.
4. **Frame** the signal into 2048-sample windows every 512 samples, left-aligned with no padding.
5. **Spectrum**: Hann window, then FFT magnitude per frame.
6. **Frame features**: RMS, spectral centroid, bass power ratio, and two onset envelopes: full-band, and a beat band at or below 150 Hz.
7. **Tempogram**: autocorrelate the beat-band onset envelope in 8-second windows and average over the track.
8. **Tempo**: pick the autocorrelation lag with the best score after weighting by a log-normal prior centred on 120 BPM.
9. **DSP beat tracker**: dynamic programming finds the beat sequence that best combines strong onsets with steady spacing at that tempo.
10. Hand tempo and beats to the rhythm engine as the `setvector_fallback` candidate.

Code: Python `src/setvector/application/analyze.py` → `analyze_track` (calls `inspect_audio`, `decode_audio`, `extract_baseline`); web `web/src/lib/analysis/client.ts` → `AnalysisClient.analyzeFile` (main thread), then `web/src/lib/analysis/analyze.ts` → `analyzeAudio` (stages `features` and `tempo`, in the worker).

### Reference numbers

The default configuration is `frame_length = 2048`, `hop_length = 512` (Python `examples/analysis-config.json` with `sample_rate: null`, `channel_policy: "mono"`; web `DEFAULT_BASELINE_CONFIG`). Every rate-dependent quantity follows from the native sample rate $f_s$:

| $f_s$ | Frame | Hop | Frames/s ($f_s/H$) | Bin width | Bins ≤ 150 Hz | Bins ≤ 250 Hz | Tempogram window $W$ |
|---|---|---|---|---|---|---|---|
| 44,100 Hz | 46.4 ms | 11.6 ms | 86.13 | 21.53 Hz | 7 (0–129 Hz) | 12 (0–237 Hz) | 689 lags |
| 48,000 Hz | 42.7 ms | 10.7 ms | 93.75 | 23.44 Hz | 7 (0–141 Hz) | 11 (0–234 Hz) | 750 lags |
| 22,050 Hz | 92.9 ms | 23.2 ms | 43.07 | 10.77 Hz | 14 (0–140 Hz) | 24 (0–248 Hz) | 344 lags |

---

## 1. File identity and decoding

**What and why.** Analysis results are cached and linked by content, not by file name, so the first step hashes the bytes. Decoding then produces raw samples with no gain change, because loudness is itself a measurement (see [key-loudness-structure.md](key-loudness-structure.md)).

**Inputs → outputs.** File bytes → asset ID (64-character lowercase hex SHA-256) and `float32` samples shaped `(channels, samples)` with a sample rate in Hz.

**Python.**
- `inspect_audio` hashes the file in 1 MiB chunks (`_HASH_CHUNK_BYTES = 1 << 20`) and reads header metadata with `soundfile.info`: duration $=\text{frames}/f_s$, native rate, channel count, format and subtype. These values become an immutable `AudioAsset`. Empty or unreadable files raise `InputError`; content libsndfile cannot recognize raises `UnsupportedAudioError`.
- `decode_audio` re-hashes the file before and after `soundfile.read(..., dtype="float32", always_2d=True)` and raises `DecodeError` if the bytes changed after inspection. This keeps the asset ID honest when the file is edited mid-analysis.
- `extract_baseline` compares decoded length $L/f_s$ with the header duration and warns when they differ by more than `_DURATION_TOLERANCE_SECONDS = 0.25` s. Timing always follows the decoded audio. This is mainly an MP3 issue: without a Xing/Info header the reported length is only an estimate.

**Web.**
- `assetId` computes the same SHA-256 with `crypto.subtle.digest`, so a file gets the same asset ID in the browser and the CLI.
- `decodeFile` uses the browser's `AudioContext.decodeAudioData`, which always resamples to the context's rate. To avoid that, `sniffSampleRate` reads the native rate from the header and opens the context at that rate:
  - WAV: the `fmt ` chunk's rate field.
  - FLAC: the 20-bit rate in STREAMINFO (bytes 18–20).
  - MP4/M4A: the first `mdhd` box's timescale (the scan covers the first 4,000,000 bytes).
  - MP3: skips an ID3v2 tag, then reads the first frame header (44.1/48/32 kHz base, halved for MPEG-2, quartered for MPEG-2.5).
  - Rates outside 8,000–384,000 Hz are rejected (except in the MP3 branch, which returns a table value).
- If sniffing fails or the browser refuses that rate, the default context is used, and its rate depends on the device (often 44.1 or 48 kHz). The decoded channels are copied and transferred to the worker.

Code: `src/setvector/ingestion/audio.py` → `inspect_audio`, `decode_audio`, `_content_hash`; `src/setvector/domain/audio.py` → `AudioAsset`; `web/src/lib/analysis/metadata.ts` → `assetId`, `sniffSampleRate`; `web/src/lib/analysis/client.ts` → `decodeFile`.

## 2. Channel mixing and resampling

**What and why.** Rhythm and spectral shape do not need stereo, and one channel halves the work. Features are measured at the native rate so their timing sits on the original samples.

**Mono mix (both).** $x[n] = \frac{1}{C}\sum_{c=1}^{C} x_c[n]$.

**Python config.** `AnalysisConfig` holds four signal settings:
- `sample_rate`: `null` keeps the native rate; an integer resamples with soxr `quality="HQ"`.
- `frame_length` and `hop_length`: positive integers with `hop_length ≤ frame_length`.
- `channel_policy`: `"mono"` averages channels before any resampling; `"preserve"` keeps every channel.

`config_id` is the SHA-256 of the config's canonical JSON (sorted keys, no whitespace). Its docstring notes that these settings "do not yet define feature algorithms or an energy model".

**Web.** The settings are fixed: always `mixToMono` and always the native (or fallback context) rate. The web app resamples only for the stages that need 22,050 Hz (Beat This! and the chromagram). It does this with its own band-limited resampler, because soxr is not available in the browser. Each output sample $j$ is a weighted sum of input samples around the position $j/r$, where $r = f_\text{out}/f_\text{in}$:

```math
y[j] = \sum_{i} x[i]\; h\!\left(\left|\,i - \tfrac{j}{r}\right|\right), \qquad
h(u) = \rho\,\operatorname{sinc}(\rho u)\,\frac{I_0\!\left(\beta\sqrt{1-(u/W)^2}\right)}{I_0(\beta)} \;\; (u < W),
```

where $\operatorname{sinc}(v)=\sin(\pi v)/(\pi v)$, the cutoff is $\rho = 0.97\min(1,r)$, the half-width is $W = \lceil 32/\min(1,r)\rceil$ input samples, and the Kaiser shape is $\beta = 8.6$.
- The sinc is an ideal low-pass filter that removes content above the new Nyquist frequency. The Kaiser window truncates it smoothly.
- Multiplying by $\rho$ keeps the DC gain near 1.
- The kernel is tabulated at 512 points per input sample and linearly interpolated.
- Output length is $\lfloor L r \rfloor$.

The file comment says the passband is flat to about 0.9 of the lower Nyquist frequency. It is not bit-identical to soxr. The Python Beat This! path resamples with soxr (default quality) inside `log_mel`.

Code: `src/setvector/domain/config.py` → `AnalysisConfig`; `src/setvector/ingestion/audio.py` → `decode_audio`; `web/src/lib/analysis/resample.ts` → `mixToMono`, `resample`, `besselI0`.

## 3. Framing

**What and why.** Music changes over time, so features are measured on short overlapping windows. Each window is long enough to resolve bass frequencies, and the hop is short enough to place onsets within about 12 ms.

**Inputs → outputs.** $L$ samples → $T$ frames, plus three time arrays in seconds.

```math
T = \begin{cases} 1 + \left\lfloor \dfrac{L - N}{H} \right\rfloor & L \ge N \\ 0 & L < N \end{cases}
\qquad
\text{omitted tail} = \begin{cases} L - \big((T-1)H + N\big) & T > 0 \\ L & T = 0 \end{cases}
```

with $N$ = `frame_length` = 2048 and $H$ = `hop_length` = 512.

- **Left-aligned.** Frame $t$ covers samples $[tH,\; tH+N)$. Nothing is centred or zero-padded, so no frame contains invented silence.
- **Final partial window dropped.** The leftover sample count is reported as `omitted_tail_samples` (Python diagnostics; web `omittedTailSamples`).
- **Timing.** Frame $t$ has centre $(tH + N/2)/f_s$ (the series timestamp), start $tH/f_s$, and end $(tH+N)/f_s$. Beat times from the DSP tracker are these frame-centre timestamps.
- **Too short.** If $T = 0$, no features are measured and both versions warn.

**Storage shape (Python).** Each feature is a `FeatureSeries`: `name`, `unit`, and five equal-length arrays (`timestamps`, `values`, `validity`, `window_starts`, `window_ends`). It enforces these rules:
- Timestamps strictly increase.
- Each timestamp lies inside a positive-width window.
- A value is `None` exactly where `validity` is `False`.

Python processes frames in chunks of `_FRAMES_PER_CHUNK = 256` so a full track never holds every spectrum in memory at once.

Code: `src/setvector/analysis/baseline.py` → `_frame_count`, `_omitted_tail`, `extract_baseline`; `src/setvector/domain/features.py` → `FeatureSeries`; `web/src/lib/analysis/features.ts` → `frameCount`, `extractBaselineFrames`.

## 4. Windowed spectrum

**What and why.** The FFT turns each frame into the strength of each frequency. A Hann window tapers the frame's edges first, so the abrupt cut does not smear energy across frequencies (spectral leakage).

```math
w[n] = 0.5 - 0.5\cos\!\left(\frac{2\pi n}{N-1}\right), \qquad
X_t[k] = \sum_{n=0}^{N-1} w[n]\,x[tH+n]\,e^{-2\pi i kn/N}, \qquad
f_k = \frac{k f_s}{N},\; k = 0,\dots,N/2
```

- This is the *symmetric* Hann window (NumPy `np.hanning`). The FFT is unscaled and one-sided, giving $N/2+1 = 1025$ bins.
- Python uses `np.fft.rfft` in float64. The web app uses its own iterative radix-2 FFT (`fft.ts`, with cached bit-reversal and twiddle tables), which only accepts power-of-two sizes. That is fine for the fixed 2048, but a non-power-of-two `frame_length` would only work in Python.
- **Python with `channel_policy: "preserve"`.** The per-channel spectra are combined by summing magnitudes, $M_t[k] = \sum_c \lvert X_{t,c}[k]\rvert$, and summing powers, $P_t[k] = \sum_c \lvert X_{t,c}[k]\rvert^2$. With mono (the default and the only web mode), $M_t[k] = \lvert X_t[k]\rvert$ and $P_t[k] = M_t[k]^2$.

Code: `src/setvector/analysis/baseline.py` → `_measure_frames`; `web/src/lib/analysis/fft.ts` → `fft`, `magnitudeSpectrum`, `hanningSymmetric`, `rfftFrequencies`.

## 5. RMS

**What and why.** Root mean square is the average signal level in a frame: a simple loudness-over-time curve. It is linear amplitude, not LUFS, and is measured on the *unwindowed* samples.

```math
\mathrm{RMS}_t = \sqrt{\frac{1}{C N}\sum_{c}\sum_{n=0}^{N-1} x_c[tH+n]^2}
```

$C = 1$ in mono. Silence gives a valid 0. Unit `linear_amplitude`.

Code: `baseline.py` → `_measure_frames`; `features.ts` → `extractBaselineFrames`.

## 6. Spectral centroid

**What and why.** The centroid is the "centre of mass" of the spectrum in Hz, a standard measure of brightness. Hi-hats and open filters raise it; a bass-only breakdown lowers it.

```math
\text{centroid}_t = \frac{\sum_k f_k\, M_t[k]}{\sum_k M_t[k]}
```

It is weighted by magnitude, not power. Frames with $\sum_k M_t[k] = 0$ (digital silence) are invalid: `None` in Python, `NaN` on the web. Unit `Hz`.

## 7. Bass power ratio

**What and why.** This is the share of the frame's energy that sits in the bass, i.e. how much the kick and bassline dominate. DJs use it to avoid stacking two basslines.

```math
\text{bass}_t = \frac{\sum_{k:\, f_k \le 250\ \text{Hz}} P_t[k]}{\sum_k P_t[k]}
```

`BASS_CUTOFF_HZ = 250.0` and the boundary is inclusive. At 44.1 kHz that is bins 0–11, including the DC bin. Frames with zero total power are invalid. Unit `ratio`, in the range 0–1.

## 8. Onset strength (positive spectral flux)

**What and why.** An *onset* is the start of a note or drum hit. At an onset, energy suddenly appears at some frequencies, so the spectrum's magnitude jumps up. Spectral flux adds up only those increases, and decays are ignored:

```math
F_t = \sum_{k} \max\!\big(0,\; M_t[k] - M_{t-1}[k]\big), \qquad F_0 = 0, \qquad
O_t = \begin{cases} F_t / \max_u F_u & \max_u F_u > 0 \\ F_t & \text{otherwise} \end{cases}
```

Two envelopes are computed from the same spectra:

| Envelope | Bins | Used for |
|---|---|---|
| `onset_strength` (Python stored series; web `onset`) | all bins | Stored as a feature (unit `normalized_flux`). The web value is computed but not used further in the current code. |
| beat onset (Python local `beat_onset`; web `beatOnset`) | $f_k \le$ `BEAT_ONSET_BAND_HZ` = 150 Hz | Tempo and DSP beat tracking only. Not stored in Python. |

**Why 150 Hz.** The comment in `identity.py` says: "full-band flux locks to off-beat hi-hats in club music". Restricting the flux to the kick's band makes the tracker follow the kick drum. At 44.1 kHz that is only 7 bins (0–129 Hz).

**Normalization.** Each envelope is divided by its *own* track maximum. Values are therefore relative within a track and cannot be compared across tracks.

Code: `baseline.py` → `_measure_frames`, `_normalized`; `identity.py` → `BEAT_ONSET_BAND_HZ`; `features.ts` → `extractBaselineFrames`, `normalizeInPlace`.

## 9. Tempogram (time-averaged autocorrelation)

**What and why.** A steady beat makes the onset envelope repeat every beat period. Autocorrelation measures how well a signal matches a copy of itself shifted by $\ell$ frames. It peaks at lags equal to the beat period and its multiples. Computing it in sliding 8-second windows and averaging over the track gives one curve of "how periodic is the track at lag $\ell$".

**Inputs → outputs.** Beat-band onset $O$ (length $T$) → mean tempogram $\bar A[\ell]$, $\ell = 0,\dots,W-1$.

**Window length** (`librosa.time_to_frames(8.0)`):

```math
W = \left\lfloor \frac{\lfloor 8 f_s \rfloor}{H} \right\rfloor \quad (689 \text{ at } 44.1\text{ kHz})
```

**Steps.**

1. **Pad.** Add $\lfloor W/2 \rfloor$ frames to each end of $O$ with a linear ramp from 0 up to the edge value (NumPy `mode="linear_ramp"`). Windows are then centred on each frame without a hard jump at the track edges.
2. **Window.** For each frame $c = 0,\dots,T-1$, take $W$ padded values and apply a *periodic* Hann window $h[j] = 0.5 - 0.5\cos(2\pi j/W)$ to get $y_c[j]$.
3. **Autocorrelate and normalize.**

   ```math
   A_c[\ell] = \sum_{j} y_c[j]\, y_c[j+\ell], \qquad \hat A_c[\ell] = \frac{A_c[\ell]}{\max_m \lvert A_c[m]\rvert}
   ```

   The maximum is at lag 0, so each column becomes 1 at $\ell=0$. Loud and quiet passages therefore get equal votes. All-zero columns contribute 0.
4. **Average.** $\bar A[\ell] = \frac{1}{T}\sum_c \hat A_c[\ell]$.

**Lag to tempo.** Lag $\ell$ frames corresponds to

```math
\mathrm{BPM}(\ell) = \frac{60\, f_s}{H\,\ell}
```

The tempo resolution is coarse because lags are whole frames. At 44.1 kHz the lags near house tempos map to 117.45 (lag 44), 120.19 (43), 123.05 (42), 126.05 (41), and 129.20 (40) BPM. The web parity fixture shows this directly: a synthetic 124 BPM signal yields a tempogram tempo of 123.046875 BPM. The beat-grid fit in [rhythm-and-beat-grid.md](rhythm-and-beat-grid.md) refines the final BPM.

**Implementation.**
- **Python.** `_mean_tempogram` calls `librosa.feature.tempogram(center=False)` on chunks of `_TEMPOGRAM_FRAMES_PER_CHUNK = 2048` columns of the pre-padded envelope and accumulates the sum. Its docstring says this equals librosa's default global tempo input. It avoids the gigabytes librosa would allocate by materializing every column at once.
- **Web.** `meanTempogram` does the same per column: it zero-pads to the next power of two $\ge 2W$, takes the FFT, squares the magnitudes, and runs a forward FFT again as the inverse (valid for a real, even power spectrum), dividing by the size. librosa pads to `next_fast_len(2W-1)`. Both are long enough that the circular autocorrelation is exact for lags below $W$.

Code: `baseline.py` → `_mean_tempogram`; `tempo.ts` → `tempogramWindow`, `meanTempogram`.

## 10. Tempo estimate

**What and why.** The highest tempogram peak is often at double or half the felt tempo, because a beat pattern also repeats every two beats and has energy every half beat. librosa's rule biases the choice toward typical tempos with a log-normal prior: a bell curve over $\log_2$ BPM, centred on 120 BPM with a standard deviation of one octave.

```math
\hat\ell = \arg\max_{\ell \ge 1,\ \mathrm{BPM}(\ell) < 320}\;
\Big[\ln\!\big(1 + 10^{6}\,\bar A[\ell]\big) \;-\; \tfrac12\big(\log_2 \mathrm{BPM}(\ell) - \log_2 120\big)^2\Big],
\qquad \text{tempo} = \mathrm{BPM}(\hat\ell)
```

| Constant | Value | Meaning |
|---|---|---|
| `start_bpm` | 120 | Centre of the prior |
| `std_bpm` | 1.0 | Prior width in octaves. 60 or 240 BPM loses 0.5 in score; 90 BPM loses about 0.086. |
| `max_tempo` | 320 | Lags faster than this are excluded (at 44.1 kHz, the smallest allowed lag is 17) |
| $10^6$ in `log1p` | — | librosa's numerical-stability scaling. It compresses autocorrelation so the prior can matter. |

Ties go to the smallest lag (fastest tempo) in both versions. If the beat-band onset envelope is all zeros, there is no tempo.

**Web extras: tempo candidates.** `estimateTempo` also returns up to 5 `candidates`, each with a `strength` = $\bar A$ at its lag (rounded to the nearest lag). The code comment calls this "a diagnostic, not a probability".
- `primary`: the estimate.
- `double` at $2\times$, if ≤ 250 BPM.
- `half` at $\frac12\times$, if ≥ 40 BPM.
- `peak`: local maxima of $\bar A$ in 60–200 BPM, strongest first, skipping any within 0.03 octave ($\lvert\log_2(b/c)\rvert < 0.03$, about ±2%) of an existing candidate.

`analyzeAudio` turns these into up to 4 `alternatives` for the final BPM: double, half, and the peaks, kept if they fall in 40–250 BPM and differ by more than 0.03 octave. Python computes only the single tempo.

Code: `baseline.py` → `_estimate_beats` (calls `librosa.feature.tempo(tg=...)` with defaults); `tempo.ts` → `estimateTempo`, `lagToBpm`; `analyze.ts` → `analyzeAudio` (`alternatives`).

## 11. DSP beat tracker

**What and why.** Knowing the tempo is not enough; the beats also have to be placed. The Ellis (2007) dynamic-programming tracker, as implemented in librosa 0.11, chooses the sequence of frames that maximizes two things together: onset strength at the chosen frames, and how close each gap is to the expected beat period. Python calls `librosa.beat.beat_track(onset_envelope=beat_onset, bpm=tempo, trim=False, sparse=True, units="frames")`. The web app ports the same algorithm.

**Inputs → outputs.** Beat-band onset $O$, tempo → sorted beat frame indices, converted to frame-centre seconds.

**Step 1: period in frames.** $P = \operatorname{round}(60 \cdot f_s/H / \text{tempo})$. Because the tempo came from a lag, $P$ equals that lag (for example 43 frames at 120.19 BPM, 44.1 kHz).

**Step 2: normalize.** $z_t = O_t / (\sigma + \varepsilon)$, where $\sigma$ is the sample standard deviation ($n-1$ denominator). $\varepsilon$ is `util.tiny` in librosa and $10^{-300}$ on the web.

**Step 3: local score.** Smooth with a Gaussian so a beat can sit a frame or two off an onset peak:

```math
\lambda_t = \sum_{j=-P}^{P} \exp\!\left(-\tfrac12\Big(\frac{32\,j}{P}\Big)^2\right) z_{t-j}
```

The Gaussian's standard deviation is $P/32$ frames (about 1.3 frames, or 16 ms, at 120 BPM and 44.1 kHz).

**Step 4: dynamic programming.** For each frame $t$, find the best previous beat $\tau$ between half a period and two periods back:

```math
D_t = \lambda_t + \max_{\tau \in [\,t-2P,\; t-\operatorname{round}(P/2)\,]}\Big( D_\tau - \alpha\big(\ln(t-\tau) - \ln P\big)^2 \Big),
\qquad \alpha = 100 \;(\text{tightness})
```

$D_t$ is the best total score of any beat sequence ending at frame $t$. The penalty grows with the *log-ratio* of the gap to the period. A gap 10% off costs $100(\ln 1.1)^2 \approx 0.91$; a gap of half a period costs $100(\ln 2)^2 \approx 48$. Large tightness therefore keeps the beat steady. The chosen $\tau$ is stored as the backlink. If no $\tau \ge 0$ exists, $D_t = \lambda_t$.

**Step 5: start rule.** Until the first frame with $\lambda_t \ge 0.01\max\lambda$, backlinks are set to −1. A beat path therefore cannot reach back into the silence before the music starts.

**Step 6: last beat.** Find the local maxima of $D$ (strictly greater than the left neighbour, at least the right neighbour; frame 0 never qualifies). The last beat is the latest local maximum with $D_t \ge 0.5 \times \operatorname{median}$ of those maxima.

**Step 7: backtrack.** Follow backlinks from the last beat until −1, then reverse the list.

**No trimming.** `BEAT_TRIM = False`. librosa's default trim removes leading and trailing beats weaker than half the RMS of the smoothed beat envelope. Per the code comment, that "drops quieter intro and outro beats, where DJs mix". With `trim=False`, librosa still drops beats at the track edges whose local score is exactly 0. The web port does not include this step (see the limitations section).

**Outputs.**
- **Python** keeps frame indices in `[0, T)`, deduplicates and sorts them, and returns them as `BeatPosition(frame_index, seconds)` with the tempo as `tempo_bpm`. If the tempo is non-finite or ≤ 0, or no beats remain, both are `None`/empty and a warning "no tempo or beat positions were detected" is added.
- **Web** keeps indices `< frameCount`, maps them to `timestamps`, and passes them to `evaluateCandidate("setvector_fallback", ...)`.

The baseline `tempo_bpm` is not the reported BPM in either version. The final BPM comes from the fitted grid (see [rhythm-and-beat-grid.md](rhythm-and-beat-grid.md)). Only when no grid is accepted does the web app report the tempogram tempo, with `source: "tempogram"`.

Code: `baseline.py` → `_estimate_beats`; `identity.py` → `BEAT_TRIM`; `tempo.ts` → `trackBeats`; `analyze.ts` → `analyzeAudio`.

## 12. Extractor identity

**What and why.** Python caches features under a `feature_id` derived from everything that can change the numbers. `baseline_identity` records:
- `EXTRACTOR_NAME = "baseline-v1"`, `ALGORITHM_VERSION = 3`, and the package version.
- The config.
- `PARAMETERS`: `bass_cutoff_hz` 250.0, `beat_onset_band_hz` 150.0, `beat_trim` false, `spectral_window` "hann", `onset_method` "positive_spectral_flux", `onset_normalization` "track_peak", `resampler` "soxr_hq_when_requested".
- The installed versions of numpy, scipy, soundfile, librosa, and soxr.

Changing any of these yields a new feature ID (see [data-and-storage.md](data-and-storage.md)). The web app labels its result `extractor: { name: "web-analysis", version: 1 }` with a smaller parameter set: frame/hop length, `channel_policy: "mono_mean"`, the 150 Hz and 250 Hz bands, `tempo_prior_bpm: 120`, and `analysis_sample_rate: 22050`.

Code: `src/setvector/analysis/identity.py` → `baseline_identity`, `PARAMETERS`; `web/src/lib/analysis/types.ts` → `EXTRACTOR_NAME`, `EXTRACTOR_VERSION`; `analyze.ts` → `analyzeAudio`.

## Report preview audio (Python only)

HTML reports need audio that a browser can play, and it must be the same audio that was analyzed. `load_preview` re-reads the file and refuses it if its SHA-256 differs from the asset ID.
- MP3 (`format == "MP3"`, `subtype == "MPEG_LAYER_III"`) is returned unchanged.
- Any other format is decoded in memory and encoded to MP3:
  - More than 2 channels are averaged to mono.
  - The sample rate is kept if it is a valid MP3 rate (8, 11.025, 12, 16, 22.05, 24, 32, 44.1, 48 kHz). Otherwise it is resampled with soxr HQ to the next valid rate above it, or to 48 kHz if none is above it.

The source file is never modified, and none of this affects analysis.

Code: `src/setvector/ingestion/preview.py` → `load_preview`, `_encode_mp3`.

---

## Python vs web

| Aspect | Python CLI | Web app |
|---|---|---|
| Asset ID | SHA-256 of bytes (`hashlib`, 1 MiB chunks) | SHA-256 of bytes (`crypto.subtle`); identical |
| Decoder | libsndfile via `soundfile` (WAV, FLAC, OGG, AIFF, MP3; no M4A) | Browser `decodeAudioData` (whatever the browser supports, including M4A in most browsers) |
| Decode rate | Native, or `config.sample_rate` via soxr HQ | Native when `sniffSampleRate` succeeds; otherwise the device's default context rate |
| Change detection | Re-hash before and after decode | None (bytes are already in memory) |
| Channels | `mono` (mean) or `preserve` (summed magnitudes, pooled RMS) | Always mean to mono |
| Frame / hop | Configurable; example 2048 / 512 | Fixed 2048 / 512 |
| FFT | `np.fft.rfft`, any length | Radix-2, power-of-two only |
| Frame features | RMS, centroid, bass ratio, full-band onset stored as `FeatureSeries` | Same values; parity test at 1e-4 relative tolerance on a 30 s synthetic 124 BPM signal at 44.1 kHz |
| Invalid values | `None` with `validity=False` | `NaN` |
| Tempogram | librosa `tempogram`, chunked | Ported; FFT size next power of two ≥ $2W$ |
| Tempo | `librosa.feature.tempo` (single value) | Ported, plus `candidates` and `alternatives` |
| Beat tracker | `librosa.beat.beat_track`, `trim=False` | Ported `trackBeats`; omits librosa's zero-score edge trim. Parity test requires ≥ 95% of librosa's beats within ±1 frame and a count within ±1. |
| No beats found | Tempo also set to `None` | Tempogram tempo is still returned and used if no grid is accepted |
| 22,050 Hz audio | soxr inside Beat This! `log_mel` | Kaiser-sinc `resample` for Beat This! and chroma |

## Limitations and open questions

- **Tempo resolution is one frame of lag.** Near 125 BPM at 44.1 kHz, adjacent lags are about 3 BPM apart, so the tempogram tempo is often off by 1–2 BPM. The DSP tracker's period $P$ is locked to that integer lag, so fallback beats drift against a tempo that falls between lags. The grid fit downstream exists partly to correct this.
- **Octave errors.** The 120 BPM prior is a heuristic. Tempos far from 120 (for example drum & bass at 170–175, or halftime material) can be reported at half or double. The web `alternatives` list exposes the octave relatives but does not choose between them.
- **The tempo is not a confidence.** As `docs/development.md` notes, the tracker returns a tempo for any non-constant onset envelope, including noise and steady tones. The web `strength` value is explicitly "not a probability".
- **Constant tempo assumed.** One global tempo and one period $P$ apply to the whole track. Tempo changes, live drummers, and DJ-mix recordings are not modelled at this stage.
- **The 150 Hz beat band is a heuristic for kick-driven club music.** Music without a strong kick (ambient, breaks with a quiet kick, acoustic) may give weak or misleading beat-band flux. At 44.1 kHz only 7 FFT bins (21.5 Hz each) cover the band, so its frequency resolution is coarse.
- **Per-track normalization.** `onset_strength` and the beat onset are divided by their own maximum, so they are not comparable across tracks. One very loud transient compresses the rest of the envelope.
- **Window sizes are not calibrated.** `docs/development.md` calls the example 2048/512 "starting values for experimentation, not a calibrated energy model". The `AnalysisConfig` docstring says the same.
- **The web sample rate depends on sniffing.** If the header is not recognized, features are measured at the device's default rate (often 48 kHz). The frame duration, the bins in each band, and the lag-to-BPM grid then differ from the CLI's results for the same file. The extractor `parameters` record `analysis_sample_rate: 22050` but not the feature rate; the result's top-level `sampleRate` holds it.
- **Decoder differences are unverified.** libsndfile and browser decoders may handle MP3 encoder delay and padding differently, which would shift every timestamp by a constant. The code does not check or compensate for this.
- **Python `preserve` mode is not the same as mono.** Summing magnitudes across channels is not the magnitude of the mono mix (out-of-phase content does not cancel). Features from the two policies therefore differ, and the web app only does the mono version.
- **Web beat tracker is not an exact port.** It omits librosa's edge trim of zero-local-score beats, so in tracks with digital silence at either end it may keep an edge beat that Python drops. It also rounds $P/2$ half-up where NumPy rounds half to even, so the DP search starts one frame earlier when $P \equiv 1 \pmod 4$ (for example $P = 41$, 126 BPM at 44.1 kHz). That predecessor carries a penalty of about 51, so it is almost never chosen. Parity is tested only on one synthetic signal.
- **Web resampler is approximate.** It is not bit-identical to soxr. The passband claim (flat to about 0.9 Nyquist) is a code comment, not a tested property.

