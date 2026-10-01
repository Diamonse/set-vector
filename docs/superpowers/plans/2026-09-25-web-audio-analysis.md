# Web Audio Analysis Implementation Plan

**Goal:** Let the web app analyze audio files itself, in the browser, so a user can go from music files to reviewable tempo, beat grid, key, loudness, and cue suggestions without the offline CLI. Audio never leaves the user's device; only derived measurements are stored.

**Architecture:** A pure TypeScript analysis library in `web/src/lib/analysis` ports the baseline extractor and the rhythm acceptance rules from `src/setvector/analysis`, and adds key, loudness, and structure estimates. It runs in a Web Worker. Beat and downbeat detection uses the same Beat This! `final0` network as the CLI, exported to ONNX and run with ONNX Runtime Web; without the model file the worker falls back to the DSP beat tracker and says so. Results are saved through a server action into a new `track_analyses` table and as estimates on tracks and cues. A waveform view on the track page plays the local file and edits cue regions against the detected grid.

**Tech stack:** TypeScript, Web Audio `decodeAudioData`, Web Workers, `onnxruntime-web` (WASM backend, served from the app's own origin), Vitest. Fixtures and the model export use Python with the repository's pinned PyTorch, librosa, and soxr versions plus `onnx`, `onnxruntime`, and `pyloudnorm`.

## Constraints

- Work only under `web/` and in this plan file. `feat/rekordbox-bridge` owns `src/setvector/rekordbox/`, `pyproject.toml`, the root `README.md`, and `docs/architecture.md` and `docs/development.md`; this plan does not edit them.
- The offline Python package is unchanged. The browser pipeline is a second implementation, so each ported stage has a parity test against the Python code on synthetic signals.
- Raw estimates and human decisions stay separate. Analysis writes values as `estimate` (tempo, energy source), `estimated` or `uncertain` (key), and cue regions as `estimate` with `pending` review. It never overwrites a value marked reviewed.
- Downbeats come only from the model. The DSP fallback does not label every fourth beat as a bar line.
- Key confidence is a template-correlation margin, not a probability. Loudness is ITU-R BS.1770-4 integrated loudness, not an energy score; the user's 1 to 10 energy annotation is not set automatically.
- The model file is not committed. `web/scripts/export_beat_model.py` converts the CLI's verified `final0` weights to ONNX and writes a manifest with its SHA-256; the browser verifies the hash before use.
- Commits use Conventional Commits without trailers (`AGENTS.md`).

## File map

| File | Responsibility |
|---|---|
| `web/src/lib/analysis/fft.ts` | Radix-2 real FFT and Hann windows. |
| `web/src/lib/analysis/resample.ts` | Band-limited resampling to the model rate. |
| `web/src/lib/analysis/features.ts` | Baseline frames: RMS, spectral centroid, bass power ratio, full-band and 150 Hz onset flux (port of `baseline.py`). |
| `web/src/lib/analysis/tempo.ts` | Mean tempogram, tempo candidates with half/double alternatives, dynamic-programming beat tracker (fallback). |
| `web/src/lib/analysis/grid.ts` | Piecewise-constant grid fit with tempo-change splitting, interval CV, bar statistics, acceptance reasons (port of `grid.py` and `rhythm.py` rules). |
| `web/src/lib/analysis/beat-model.ts` | Beat This! log-mel front end, chunked inference through an injected runner, peak picking and parabolic refinement (port of `_inference.py`). |
| `web/src/lib/analysis/key.ts` | Chroma and major/minor template ranking with margin and abstention, whole track and per region. |
| `web/src/lib/analysis/loudness.ts` | BS.1770-4 K-weighting, gated integrated loudness, short-term loudness series, loudness range. |
| `web/src/lib/analysis/structure.ts` | Beat-synchronous novelty, section boundary candidates, entry and exit cue suggestions snapped to the grid. |
| `web/src/lib/analysis/analyze.ts` | Orchestration, progress, extractor identity, waveform peaks. |
| `web/src/lib/analysis/worker.ts`, `client.ts` | Worker entry and a typed main-thread client; ONNX Runtime session with a hash-checked, cached model. |
| `web/src/lib/analysis/metadata.ts` | SHA-256 asset ID (same as the CLI), ID3v2 title and artist, filename fallback. |
| `web/supabase/migrations/20260925020000_track_analyses.sql` | `track_analyses` table, `cue_regions.analysis_id`, RLS. |
| `web/src/app/actions/analysis.ts` | Save results: create or match tracks by asset ID, fill estimates, replace pending suggestions from earlier analyses, record annotations. |
| `web/src/app/(app)/library/analyze/page.tsx`, `web/src/components/analysis/*` | Analyze page: file queue, progress, editable review table, save. |
| `web/src/components/library/audio-editor.tsx` | Track page Audio tab: waveform, beat and downbeat markers, playback, draggable cue regions, approve or reject. |
| `web/scripts/export_beat_model.py`, `web/scripts/copy-ort-wasm.mjs` | Model export and ONNX Runtime WASM assets. |
| `web/tests/analysis/*.test.ts`, `web/tests/fixtures/analysis/*.json` | Unit and parity tests; fixtures generated by `web/scripts/make_analysis_fixtures.py`. |

## Tasks

1. **Signal core.** FFT, windows, resampler. Test against direct DFT and known sinusoids.
2. **Baseline features.** Port frame layout (2048/512, left aligned, no padding), RMS, centroid, bass ratio, flux series. Parity with `extract_baseline` on synthetic signals within 1e-6 relative.
3. **Tempo and fallback beats.** Mean tempogram over 8 s windows with librosa's log-normal tempo prior; candidates at the top peaks and half/double; Ellis dynamic-programming tracker. Test on click tracks at 90, 124, and 174 BPM and compare the tempo with librosa's.
4. **Grid and acceptance.** Reference period, initial indices, robust least-squares lines, tempo-change splitting and tidying (up to 8 segments), gap closing, 40 ms grid fit, interval CV, modal bar length and regularity, bar positions, and the reason strings with the thresholds in `identity.py`. Parity with `fit_grid` and `_evaluate` on synthetic beat lists, including a tempo change.
5. **Beat This! in the browser.** Export script (verified weights or `--random-weights` for testing); log-mel parity with `_inference.log_mel` at 22.05 kHz; chunking identical to `frame_logits`; peak picking and refinement identical to `pick_peaks` and `refine_peak_times`. ONNX parity with PyTorch on random weights in Python; TypeScript chunking tested with a fake runner.
6. **Key.** STFT chroma (65 Hz to 2.1 kHz), Krumhansl-Kessler and Temperley profile correlation, ranking with margin; `uncertain` below a margin or tonal-strength threshold. Tests on synthetic major and minor progressions.
7. **Loudness.** K-weighting coefficients for any sample rate, 400 ms blocks with 75% overlap, absolute and relative gates, 3 s short-term series, loudness range. Test on the BS.1770 stereo sine reference and against `pyloudnorm`.
8. **Structure and cues.** Beat-synchronous chroma and timbre features, checkerboard novelty, peak picking, and suggestions: an entry region at the start of the grid and an exit region at the last strong boundary in the final third, each 32 beats where the track allows. Labels say these are estimated boundaries.
9. **Worker and client.** Decode on the main thread, transfer channel data, progress messages, model fetch with Cache Storage and SHA-256 check, WASM served from `/ort/`.
10. **Persistence.** Migration and server action with the update rules above; re-analysis replaces its own pending suggestions only.
11. **Analyze page.** Drop zone, sequential queue, per-file status, review table with editable title, artist, and match, save selected.
12. **Audio editor.** Local file picker with asset-ID check, waveform canvas, beat and downbeat markers, cue overlays, playback with keyboard control, drag to create or resize regions snapped to beats, approve or reject, accessible table remains the source of truth.
13. **Docs and checks.** `web/README.md` setup for the model and migration; typecheck, tests, build, and a browser run of the analyze and audio flows.

## Evaluation and limits

- Parity tests establish that the port reproduces the Python stages on synthetic inputs. They do not establish accuracy on the six target styles; the evaluation plan in `docs/research/playlist-engine-evaluation.md` still applies to both implementations.
- The browser decoder may differ from libsndfile or FFmpeg by a few samples at the start of compressed files; asset IDs are unaffected because they hash file bytes.
- WASM inference of the 20 M parameter model is slower than native PyTorch; long tracks take tens of seconds per file on a laptop.
