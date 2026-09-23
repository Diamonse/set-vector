# Rhythm Engine Design

## Goal

Give every analyzed track a trustworthy beat grid with real downbeats, stored as a separately versioned rhythm artifact. Beat This! is the primary detector and becomes a required dependency with a bundled checkpoint. SetVector's own beat tracker, with a bass-band onset fix, is the fallback. When neither result is reliable, the artifact records that no grid is available instead of presenting a wrong one.

This is the first of three sub-projects toward Rekordbox integration:

1. **Rhythm engine** (this document).
2. **Rekordbox bridge:** read the user's Rekordbox XML export (grids, cues) and write an importable Rekordbox XML. Existing Rekordbox grids are never replaced; SetVector grids are written only for tracks without one. Hot cues fill empty slots only, SetVector replaces only its own labelled cues, and tracks with no free slot are reported. Imported Rekordbox grids become a third rhythm source and the accuracy reference for this engine.
3. **Phrase detection and mix-in/out suggestions:** computed on the best available bar grid (Rekordbox, then Beat This!, then fallback) and exported as memory cues and hot cues through the bridge.

This design replaces two earlier positions: the [Analysis Engine Extension](../../research/analysis-engine-extension.md) note that PyTorch and model weights stay outside core dependencies, and the plan to build a rule-based downbeat baseline before any learned model.

## Evidence

A spike on three tracks from the user's library (two club tracks and an acapella) produced these results:

- Beat This! 1.1.0 (`final0` checkpoint, CPU, minimal postprocessor) produced regular 4-beat bars on both club tracks at about 30× real time, and failed on the acapella: about 65 BPM, erratic bar lengths.
- Beat This! beat times lie on its 50 frames-per-second grid (20 ms resolution). Their median interval is 0.48 s on both club tracks, which reads as 125.00 BPM, but a constant-tempo least-squares fit through the beats gives 124.00 and 126.00 BPM. The median-interval tempo is a quantization artifact; tempo must come from a fitted grid.
- The fitted grid holds 100% and 95% of the beats within 40 ms. Raw beats deviate from it with a standard deviation of 8.3 and 7.9 ms; parabolic sub-frame interpolation of the beat activations lowers this to 6.5 and 5.8 ms.
- Only 30% and 44% of the current baseline's beats land on Beat This! beats; 66% and 54% land on the off-beat. The full-band positive spectral flux onset envelope is dominated by off-beat hi-hats and claps, so librosa's dynamic-programming tracker locks to the off-beat phase for whole minutes.
- Tempo quantization is not the cause of the off-beat lock. Forcing a fixed tempo, or using a 128-sample hop, left the results unchanged; librosa also rounds the beat period to whole frames internally.
- Computing the tracker's onset envelope from bins at or below 150 Hz raised on-beat agreement to 90% and 95% with 0% and 5% off-beat. Cutoffs of 100 Hz (87%, 95%) and 250 Hz (86% with 8% off-beat, 95%) were worse or equal.
- Whether the fitted grid sits early or late relative to the kick attack could not be measured: a 150 Hz low-pass onset profile averaged over all beats was flat across ±40 ms, because sidechained bass masks the kick.

Three tracks are a spike, not a validation. Sub-project 2 supplies the reference collection.

## Rhythm artifact

A rhythm analysis is immutable and content-addressed, like baseline features. The baseline artifact keeps its current meaning and is not extended.

```
workspace/
  assets/<asset_id>/asset.json
  features/<feature_id>/manifest.json, arrays.npz
  rhythm/<rhythm_id>/rhythm.json
```

`rhythm.json` contains:

| Field | Meaning |
|---|---|
| `schema_version`, `rhythm_id`, `asset_id`, `feature_id` | Identity. `feature_id` names the baseline artifact the analysis was derived with. |
| `extractor` | Name `rhythm-v1`, algorithm version, parameters (thresholds below), checkpoint name and SHA-256, and versions of `beat-this`, `torch`, `numpy`, `soxr`. |
| `source` | `beat_this`, `setvector_fallback`, or `none`. Sub-project 2 adds `rekordbox`. |
| `grid_segments` | Ordered constant-tempo segments, each with `start_seconds` (its first grid beat), `bpm`, `beat_count`, and `first_bar_position` (1-based, or `null` when bars are unknown). Rekordbox's grid format maps one segment to one tempo marker. |
| `beats` | Grid beat times in decoded-source seconds, generated from `grid_segments`. Empty when `source` is `none`. |
| `bar_positions` | For each grid beat, its 1-based position in the bar, or `null` for every beat when bars are unknown. Rekordbox's grid format needs this position per beat. |
| `detected_beats` | The selected detector's refined beat times before grid fitting, kept for diagnosis and later calibration. |
| `tempo_bpm` | The `bpm` of the segment covering the most beats, or `null`. |
| `quality` | A mapping from each evaluated candidate (`beat_this`, `setvector_fallback`) to its `beat_count`, `interval_cv` (inter-beat interval coefficient of variation), `grid_fit` (fraction of detected beats within 40 ms of their segment's grid), `segment_count`, `modal_bar_length`, and `bar_regularity` (fraction of bars with the modal length). Bar measures are `null` for a candidate without downbeats. A candidate that was not evaluated is absent. |
| `reliable`, `reasons` | Whether the grid passed its checks, and human-readable reasons for each rejection. |

Downbeats are the beats with `bar_positions == 1`, derived rather than stored twice. `rhythm_id` is the SHA-256 of the canonical JSON of `feature_id` and the rhythm extractor identity. It can therefore be computed before decoding, and a cache hit skips inference.

## Components

| File | Responsibility |
|---|---|
| `domain/rhythm.py` | `RhythmAnalysis` and `RhythmQuality` with strict validation (sorted finite beats inside the decoded duration, matching lengths, bar positions all known or all `null`, source/reliability consistency) and `to_dict`/`from_dict`. |
| `analysis/beat_this.py` | The only module that imports `torch` or `beat_this`, imported lazily. Verifies the bundled checkpoint's SHA-256, loads it from its package path, runs the model once on decoded mono samples to get frame activations, and applies Beat This!'s minimal postprocessor to them. Returns beat and downbeat times, with each beat refined by parabolic interpolation of the beat activation around its peak frame (offset clamped to ±0.5 frame; no refinement at the track edges or when the peak is not a strict local maximum). |
| `analysis/grid.py` | Pure NumPy grid fitting, described below. No knowledge of detectors. |
| `analysis/rhythm.py` | `extract_rhythm(decoded, baseline_bundle, runner=beat_this.detect) -> RhythmAnalysis`. It fits a grid to each candidate, scores candidates, selects the source, and assigns bar positions to grid beats. The injectable runner keeps most tests free of PyTorch. |
| `analysis/identity.py` | Adds `rhythm_identity(baseline_extractor)` next to `baseline_identity`. |
| `storage/publish.py` | Shared atomic publish-and-verify helper extracted from `ArtifactStore._publish`, used by both stores. |
| `storage/rhythm.py` | `RhythmStore` with `load`, `load_stored`, `save`, and the same corruption and conflict handling as `ArtifactStore`. |
| `models/beat_this-final0.ckpt` | Bundled checkpoint (81 MB). |
| `models/LICENSE-beat-this` | Beat This! MIT license for the code and weights. |

## Grid fitting

`fit_grid(beat_times) -> GridFit` turns detected beats into constant-tempo segments:

1. **Index beats.** With the reference period `p` equal to the median inter-beat interval, beat `i` gets index `k_i = k_{i-1} + round((t_i - t_{i-1}) / p)`, so a missed beat leaves a gap in the indices instead of stretching the tempo.
2. **Fit a line.** Least squares of time against index, then refit up to five times excluding beats more than 40 ms from the line. The slope is the beat period; `bpm = 60 / slope`.
3. **Accept or split.** A segment is accepted when at least 90% of its beats are within 40 ms. Otherwise it is split at the beat index that maximizes the combined inlier count of the two refitted halves, provided each half has at least 32 beats, and each half is processed again. Splitting stops at 8 segments.
4. **Generate grid beats.** Each segment emits beats at `start_seconds + n × 60 / bpm` from its first to its last indexed beat, which also fills beats the detector missed. Where two segments meet, the later segment starts at the first grid beat after the earlier one's last.

`grid_fit` is the fraction of all detected beats within 40 ms of their segment's grid.

## Source selection

1. Run Beat This! and fit its grid. Its candidate is **reliable** when it has at least 32 beats, `interval_cv <= 0.15`, `grid_fit >= 0.90`, a modal bar length of 3 or 4, and `bar_regularity >= 0.75`. The spike measured interval CV 0.048 and 0.050, grid fit 1.00 and 0.95, and regularity 0.99 and 0.87 on the club tracks, against interval CV 1.224 and regularity 0.60 (modal length 1) on the acapella. Each detected downbeat marks its nearest grid beat as position 1; grid beats between downbeats count up from there, and beats before the first downbeat count backward from the modal bar length.
2. Otherwise fit a grid to the baseline beats as the fallback candidate. It is reliable when it has at least 32 beats, `interval_cv <= 0.15`, and `grid_fit >= 0.90`. Bar positions are all `null`: the fallback does not guess downbeats.
3. Otherwise the source is `none`, with empty beats and both candidates' rejection reasons.

The thresholds are recorded extractor parameters. Changing them changes `rhythm_id`. They are provisional until sub-project 2 measures them against the user's Rekordbox grids.

## Baseline fallback fix

`_measure_frames` additionally accumulates positive spectral flux over bins at or below 150 Hz, normalized to its own track peak, in the same chunked pass. `_estimate_beats` uses this bass envelope for both tempo estimation and beat tracking. The stored `onset_strength` series stays full-band so its report meaning does not change. `ALGORITHM_VERSION` becomes 3 and `PARAMETERS` gains `beat_onset_band_hz: 150.0`, so existing baseline artifacts remain valid but are not reused.

## Application and CLI flow

`analyze_track` computes `feature_id` and `rhythm_id` after inspection, and loads each from its store. If either is missing, it decodes once and runs only the missing stages, baseline first. `AnalysisOutcome` gains `rhythm` and `rhythm_cache_hit`. The `analyze` command's JSON result gains `rhythm_id`, `rhythm_source`, `rhythm_reliable`, and `downbeat_count`. No new command is added.

`render_report` computes the `rhythm_id` for the stored feature artifact under the current environment. When that rhythm artifact exists and is reliable, `build_report_model` takes its beats, derived downbeats, and tempo, and the existing bar-line code in `report.js` draws real bars. Otherwise the report keeps baseline beats, draws no downbeat bars, and adds a warning stating why.

## Packaging and offline behavior

- `pyproject.toml` adds exact pins for `beat-this==1.1.0`, `torch`, `torchaudio`, `einops`, and `rotary-embedding-torch`, following the project's existing exact-pin style. The versions are chosen during implementation from one set that installs and passes the suite together on Python 3.11 to 3.13.
- The checkpoint is not committed to Git, whose hosting limits make an 81 MB binary impractical. `scripts/fetch_model.py` downloads it from Beat This!'s published URL, verifies a pinned SHA-256, and writes it to `src/setvector/models/`, where Git ignores it. Development setup and wheel builds run this script. The wheel and sdist include the file, and the build fails if it is missing or its hash differs.
- At runtime the checkpoint loads only from the package path after hash verification. SetVector never calls Beat This!'s download path or torch hub. A missing or mismatched checkpoint raises an installation error naming the expected path; it never triggers the fallback or a download.
- An installed wheel grows by about 80 MB. CPU PyTorch occupies about 544 MB on Windows. On Linux, plain `pip install` of PyTorch selects the much larger CUDA build; the README documents installing with `--extra-index-url https://download.pytorch.org/whl/cpu`, because package metadata cannot select that index.
- `license-files` gains the Beat This! license, and the README notes that its authors state some training data was copyrighted.
- `docs/architecture.md`, `docs/research/analysis-engine-extension.md`, and `README.md` are updated to state that learned beat tracking is part of core analysis and loads from a bundled, hash-verified local artifact.

## Errors

- Beat This! raising during inference is an `AnalysisError`; the fallback exists for unreliable output, not for crashes that would hide defects.
- Missing, unreadable, or hash-mismatched checkpoint: an installation error with the expected path and hash.
- Corrupt or conflicting rhythm artifacts: `ArtifactError`, as for features.
- `source == none` is not an error. `analyze` succeeds, reports `rhythm_reliable: false`, and lists the reasons.

## Testing

- **Fallback fix, written first and failing on the current code:** a synthetic 125 BPM signal with kicks on beats and louder hi-hats on off-beats must yield baseline beats within 70 ms of the kicks for at least 90% of beats.
- **Grid fitting:** beats at 124 BPM jittered to 20 ms frames recover 124.00 ± 0.01 BPM (the median interval would read 125); missed and extra beats do not change the tempo; a tempo change from 120 to 128 BPM mid-track yields two segments with the change within one bar; fewer than 64 beats never split; a random beat sequence gives `grid_fit < 0.90`.
- **Sub-frame interpolation:** a synthetic activation with a known peak between frames is refined to within 2 ms; edge frames and flat peaks are left unrefined.
- **Selection logic with a stub runner:** a regular 4/4 candidate is chosen with correct bar positions, including pickup beats before the first downbeat; an irregular candidate falls back to regular baseline beats with `null` bar positions; both irregular yields `none`; threshold edges are covered.
- **Domain and storage:** round trip, strict validation failures, ID stability and sensitivity to every identity input, atomic publish, corruption and conflict handling, reuse of the shared publish helper by `ArtifactStore` with its existing tests unchanged.
- **Application:** one decode when both stages are missing, rhythm-only rerun when only the rhythm is missing, and cache hits for both.
- **Real model:** one integration test runs the bundled checkpoint on a synthesized accented 4/4 click track and checks beats within 40 ms and downbeats on accented beats. Tests that need the checkpoint fail with a message naming `scripts/fetch_model.py` when it is absent; they are not skipped, because the model is a required part of the package.
- **Offline:** extend `tests/test_offline_analysis.py` so the blocked-socket `analyze` run covers the rhythm stage with `TORCH_HOME` pointing to an empty temporary directory, and asserts nothing is written there.
- **Report:** the model uses reliable rhythm beats and downbeats and falls back with a warning otherwise.
- **Manual check:** re-analyze the three spike tracks and confirm the club tracks get `beat_this` with 4-beat bars, the acapella gets a non-`beat_this` source with reasons, and the rendered reports show bar lines on downbeats.

## Limitations

- The grid's absolute phase follows Beat This!'s beat positions. Whether that sits on the kick attack, and whether a global offset is needed, is measured against the user's Rekordbox grids in sub-project 2.
- Grid fitting assumes piecewise-constant tempo. Tracks with continuous tempo drift (live drums, rubato) either split into several segments or fail `grid_fit` and fall back.
- The fallback supplies beats without downbeats, so phrase detection cannot run on fallback-only tracks.
- Reliability thresholds come from three tracks and must be recalibrated against the user's Rekordbox grids.
- Analysis time grows by roughly 3% of track duration on CPU, and the first run in a process pays the model load cost.
