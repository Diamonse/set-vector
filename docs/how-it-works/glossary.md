# Glossary

Short definitions of the terms used in this folder. The page in brackets has the full explanation.

## Audio and signal processing

| Term | Meaning |
|---|---|
| Asset ID | SHA-256 of a file's bytes. It identifies a track by content, and the CLI and the browser compute it the same way. [data](data-and-storage.md) |
| Sample rate ($f_s$) | Samples per second of decoded audio. The web analysis resamples to 22,050 Hz for rhythm and key. [features](audio-features-and-tempo.md) |
| Frame length ($N$) / hop length ($H$) | Samples per analysis window (2048) and samples between window starts (512). The frame rate is $f_s/H$. [features](audio-features-and-tempo.md) |
| Omitted tail | Trailing samples too short to fill a final frame. They are dropped and the count is recorded. [features](audio-features-and-tempo.md) |
| Hann window | Raised-cosine taper applied before an FFT to reduce spectral leakage. |
| FFT / magnitude spectrum | Strength of each frequency bin $f_k = k f_s / N$ in one frame. |
| RMS | Root mean square of a frame's samples. A linear level, not perceived loudness. [features](audio-features-and-tempo.md) |
| Spectral centroid | Magnitude-weighted mean frequency in Hz; a measure of brightness. [features](audio-features-and-tempo.md) |
| Bass power ratio | Share of spectral power at or below 250 Hz. [features](audio-features-and-tempo.md) |
| Spectral flux / onset strength | Sum of positive frame-to-frame increases in magnitude, i.e. how much new sound starts in each frame. [features](audio-features-and-tempo.md) |
| Beat-band onset | Spectral flux limited to ≤150 Hz, so beat tracking follows the kick. [features](audio-features-and-tempo.md) |
| Autocorrelation | Similarity of a signal with a copy of itself shifted by a lag. Repeating patterns produce peaks. |
| Tempogram | Autocorrelation of the onset envelope over sliding 8 s windows, averaged over the track. The lag $\ell$ converts to tempo as $60 f_s/(H\ell)$ BPM. [features](audio-features-and-tempo.md) |
| Log-normal tempo prior | A Gaussian penalty on $\log_2$ BPM centred at 120 with a one-octave spread, so tempi near 120 are favoured. [features](audio-features-and-tempo.md) |
| Octave error | A tempo reported at half or double the felt tempo. |
| Dynamic-programming beat tracker | The DSP fallback (Ellis 2007, via librosa). It picks the beat sequence that maximizes onset strength minus a penalty for uneven spacing (tightness 100). [features](audio-features-and-tempo.md) |
| soxr / Kaiser-sinc resampler | The high-quality sample-rate converters used by Python and by the web app respectively. [features](audio-features-and-tempo.md) |
| Chromagram | Strength of each of the 12 pitch classes per frame, ignoring octave. [key](key-loudness-structure.md) |
| Pitch class | A note name without octave: C, C#, … B, numbered 0–11. |
| Key profile / template | 12 weights for how well each scale degree fits a major or minor key, from listening experiments. Krumhansl–Kessler is the default. [key](key-loudness-structure.md) |
| Key margin | Correlation of the best key minus that of the runner-up. An algorithm diagnostic, not a probability. [key](key-loudness-structure.md) |
| Voiced frame | A frame within 40 dB of the track's loud parts, so it carries pitch information. [key](key-loudness-structure.md) |
| LUFS / LU | Loudness Units relative to Full Scale (ITU-R BS.1770), and differences in those units. [loudness](key-loudness-structure.md) |
| K-weighting | A shelf filter plus a high-pass filter that model the ear before loudness is measured. [loudness](key-loudness-structure.md) |
| Gating | Ignoring blocks that are silent (−70 LUFS absolute) or much quieter than average (−10 LU relative) when averaging loudness. [loudness](key-loudness-structure.md) |
| Loudness range (LRA) | 95th minus 10th percentile of gated short-term loudness (EBU Tech 3342). [loudness](key-loudness-structure.md) |
| Sample peak / true peak | The largest absolute sample, versus the oversampled inter-sample peak. SetVector reports sample peak only. |
| Novelty curve | How strongly the music changes at each beat, from a checkerboard kernel slid along a self-similarity matrix (Foote). [structure](key-loudness-structure.md) |
| Self-similarity | Cosine similarity between the feature vectors of two beats. |
| Section boundary | A peak in the novelty curve. It marks where the music changes, not a verified phrase or drop. [structure](key-loudness-structure.md) |
| Phrase | 8 bars (32 beats in 4/4), counted from the first bar line. Cue suggestions start on phrases; the length is assumed, not detected. [structure](key-loudness-structure.md) |
| Phrase-aligned suggestion | An entry or exit region of 32 beats starting on a phrase. Up to three per kind, from the analyzer (`Suggested …`) or a Rekordbox grid (`Grid …`). [structure](key-loudness-structure.md) |
| Onset rate | Detected note and drum attacks per second of non-silent audio, from peak-picking the onset envelope. An energy input. [energy](energy-estimate.md) |
| Loud-section loudness | 90th percentile of the 3 s short-term loudness: how loud the main sections are, unaffected by quiet intros. [energy](energy-estimate.md) |

## Rhythm

| Term | Meaning |
|---|---|
| Beat This! | The neural beat and downbeat detector bundled with SetVector. It runs on CPU PyTorch in Python and on ONNX Runtime Web in the browser. [rhythm](rhythm-and-beat-grid.md) |
| ONNX / ONNX Runtime Web | A portable neural-network file format, and the WebAssembly runtime the browser uses to run Beat This!. [rhythm](rhythm-and-beat-grid.md) |
| Log-mel spectrogram | The model's input: magnitude STFT summed into 128 mel bands at 50 frames/s, compressed with $\log(1 + 1000x)$. [rhythm](rhythm-and-beat-grid.md) |
| Logit / activation | The model's raw per-frame beat or downbeat score. $\sigma(\text{logit}) > 0.5$ means "beat here". |
| Chunk / border | A 1,500-frame (30 s) model input. 6 frames at each edge are discarded when chunks are joined. |
| Peak picking | Keep frames that are the local maximum within ±3 frames and have $p > 0.5$. |
| Parabolic refinement | Move a peak to the vertex of a parabola through three logits, for timing finer than one frame. |
| Inlier | A detected beat within 40 ms of its fitted grid line. |
| `grid_fit` | Inliers divided by detected beats; a candidate quality metric. |
| `interval_cv` | Standard deviation ÷ mean of inter-beat intervals shorter than 1.5 × the median; measures beat-spacing steadiness. |
| Bar regularity | The share of bars whose length equals the most common bar length. |
| Bar phase | Grid index modulo bar length. A new phase is adopted only after 4 consecutive downbeats agree. |
| Weights SHA-256 | A hash over the sorted `.npz` member names and bytes (ignoring zip metadata), checked before the model loads. |
| Downbeat | The first beat of a bar. |
| Bar position | A beat's 1-based position within its bar (1 = downbeat). |
| Beat grid | The fitted list of beats, made of one or more constant-tempo segments. [rhythm](rhythm-and-beat-grid.md) |
| Grid segment | A run of evenly spaced beats with one start time, one BPM, and a starting bar position. [rhythm](rhythm-and-beat-grid.md) |
| Rhythm candidate | A beat list proposed by one source (`beat_this` or `setvector_fallback`) and checked against the quality rules. [rhythm](rhythm-and-beat-grid.md) |
| `setvector_fallback` | The DSP tracker's beats offered as a candidate when Beat This! fails or is rejected. It never carries downbeats. |
| Rhythm source | Which candidate was chosen: `beat_this`, `setvector_fallback`, or `none`. A grid is *reliable* exactly when the source is not `none`. |
| BPM alternatives | Half, double and other plausible tempi stored beside the chosen BPM, so the planner can match at a different beat level. |

## Data and status

| Term | Meaning |
|---|---|
| Measurement source | `estimate` or `reviewed`; records whether a person has confirmed a BPM, an energy value or a cue. [data](data-and-storage.md) |
| Key status | `unknown`, `estimated`, `uncertain`, `reviewed`, or `not_meaningful`. Only the first three may be overwritten by analysis. [data](data-and-storage.md) |
| Review status | For cues: `pending`, `approved`, or `rejected`. Independent of provenance. |
| Artifact | A validated, content-addressed file or folder the CLI writes once and never changes: feature manifest and arrays, rhythm JSON, report HTML. [data](data-and-storage.md) |
| Feature bundle | The Python object holding one track's four baseline feature series plus tempo, beats and diagnostics, identified by its feature ID. |
| Cache identity | A SHA-256 hash of exactly the inputs that could change a result (asset, config, extractor versions). It names the artifact folder. [data](data-and-storage.md) |
| Config ID / feature ID / rhythm ID | Cache identities of an analysis config, of a baseline-feature result, and of a rhythm result. Each chains to the previous one. |
| Canonical JSON | Sorted keys, no whitespace, no NaN, so the same object always hashes to the same bytes. |
| Schema version | An integer on every manifest and contract. Only `1` is accepted today. |
| Annotation | An append-only revision record. Each new revision points to the one it supersedes. |
| RLS | Postgres row-level security. Every row is visible only to its owner (`owner_id = auth.uid()`). |
| Server action | A Next.js function that runs only on the server. All web writes go through one. |
| Track analysis (`track_analyses`) | The full JSON result of one browser analysis, keyed by asset ID plus extractor identity. |
| Energy estimate | A 1–10 energy value computed by ranking a track's measurements against the rest of the library (`library-percentile-v1`). Experimental and uncalibrated. [energy](energy-estimate.md) |
| Mid-rank percentile | The share of other tracks below a value, counting ties as half: $(b + (q-1)/2)/(n-1)$. [energy](energy-estimate.md) |
| Reference range / prior weight | A fixed low–high range per energy input that each library rank is blended with, weighted as 8 tracks, so small libraries still score sensibly. [energy](energy-estimate.md) |
| `energy_model` | Column naming the model that wrote a track's energy. Null means the user or an import set it, and the estimator then never touches it. [energy](energy-estimate.md) |
| Rekordbox link (`rekordbox_links`) | One Rekordbox collection entry linked to a library track, holding its `Location`, grid and cue points. [rekordbox](rekordbox-bridge.md) |
| Drift test | A web test that reads the Python analyzer's constants and versions and fails when the browser port no longer matches them. [data](data-and-storage.md) |

## Planner

| Term | Meaning |
|---|---|
| Camelot wheel | 24 keys on 12 positions around the circle of fifths. A = minor, B = major; number $= (7\cdot\text{tonic} + 5\text{ or }8) \bmod 12$. [key](key-loudness-structure.md) |
| Wheel steps | Circular distance between two Camelot numbers, 0–6. |
| Directional transition | A → B, scored from A's exit region into B's entry region. B is tempo-matched to A, so A → B and B → A differ. [planner](set-planner.md) |
| Transition cost | Weighted average (0–1) of the harmonic, tempo, energy-step, cue, vocal and style costs for one pair. [planner](set-planner.md) |
| Tactus / tempo multiple | The beat level used to match tempo: B's BPM, double, half, or a stored alternative. A multiple other than 1 adds 0.15. |
| Key lock | Keeps B's pitch when its tempo changes. When it is off, B's key is transposed by $\operatorname{round}(12\log_2 \text{rate})$ semitones. |
| Transition type | `blend` (up to 32 beats), `short_blend` (8 beats), `cut`, or `sequential` (listening mode). It scales the harmonic and vocal weights. |
| Cue origin | `reviewed`, `estimated`, `pending`, `fallback`, or `full_track`, with costs 0, 0.35, 0.4, 0.7 and 0. |
| Fallback window | Intro or outro window used when a track has no cue. [planner](set-planner.md) |
| Energy arc | Target energy as a piecewise-linear function of the fraction of elapsed planned playback time. |
| Arc cost / coverage | Time-weighted RMSE ÷ 9 × coverage + 0.15 × (1 − coverage). Coverage is the share of planned time that has energy values. |
| Joint cue assignment | A Viterbi pass that picks entries and exits along the whole order, so every track keeps a valid played span. |
| Objective | $W_\text{mean}\cdot\text{mean} + W_\text{worst}\cdot\text{worst} + W_\text{arc}\cdot\text{arc} + W_\text{div}\cdot\text{diversity} + \text{duration} + 3\times\text{hard violations}$. Lower is better. |
| Beam search | Builds orders left to right while keeping the best `beamWidth` partial orders. |
| Local search | Swap, relocate, replace, add and remove moves, each kept only if it lowers the objective. |
| Alternative | A runner-up plan within 1.3 × the proposal's objective + 0.1 that shares fewer than 75 % of its adjacent pairs with the plans already chosen. |
| Exact solver | Tries every ordering of a fixed crate of up to 8 tracks, to measure the optimizer gap. |
| Optimizer gap | $(J_\text{proposal} - J_\text{exact}) / J_\text{exact}$, floored at 0. |
| Baseline | A simple ordering of the same tracks (random, BPM-sorted, Camelot walk, greedy) scored with the same objective, for comparison. |
| Seed | Input to the mulberry32 random generator. Today only the random baseline uses it. |

## Rekordbox

| Term | Meaning |
|---|---|
| Rekordbox XML | The *File › Export Collection* format. SetVector's only interchange format with Rekordbox; it never touches Rekordbox's live database. [rekordbox](rekordbox-bridge.md) |
| TEMPO marker | One beat anchor in a Rekordbox grid (`Inizio`, `Bpm`, `Metro`, `Battito`). Rekordbox extrapolates the beats between anchors at constant tempo. |
| Inizio | A TEMPO marker's anchor time in seconds, to three decimals. |
| Metro / Battito | Time signature (e.g. `4/4`), and the anchor beat's 1-based position within its bar. |
| POSITION_MARK | One cue, loop, fade or load point. `Num = -1` is a memory cue; 0–7 are hot cues A–H. |
| Bridging marker | An extra TEMPO marker on a segment's last beat, so Rekordbox does not predict a phantom beat inside a gap between segments. |
| Capability profile | The import behaviour measured for one Rekordbox version (hot-cue slots, memory-cue limit, colours, re-import behaviour). It is filled only from probe results. |
| Drift tolerance | 5 ms: the most accumulated BPM-rounding error allowed before a new TEMPO marker is started. |
| Web import | The web app's read-only Rekordbox import. It links tracks by `Location`, then by title and artist, and turns cues into approved entry and exit regions. [rekordbox](rekordbox-bridge.md) |
| M3U8 playlist | A text playlist of file paths (`#EXTM3U`, one `#EXTINF` line per track). The web app exports plans in this format for Rekordbox, using paths from Rekordbox-linked tracks. [rekordbox](rekordbox-bridge.md) |
| Cue role | Whether a Rekordbox cue becomes an entry or an exit: from its type (fade-in, fade-out), then its name (Intro, Mix out, …), then its position (first or last third). [rekordbox](rekordbox-bridge.md) |
