# How SetVector works

This folder explains how the project works: what each part computes, the formulas and constants it uses, why it is built that way, and where the code lives. It describes the code as it is. Plans and research are in [`docs/architecture.md`](../architecture.md), [`docs/research/`](../research/) and [`docs/superpowers/`](../superpowers/).

## Reading order

| # | Page | Covers |
|---|---|---|
| 1 | [System overview](overview.md) | The three parts, operating principles, the life of a track, where code lives, what is not built yet |
| 2 | [Audio features and tempo](audio-features-and-tempo.md) | Decoding, hashing, resampling, frame features (RMS, centroid, bass ratio, onset strength), tempogram, DSP beat tracker |
| 3 | [Rhythm and beat grid](rhythm-and-beat-grid.md) | Beat This! model, offline weights, grid fitting, candidate selection, final BPM |
| 4 | [Key, loudness, and structure](key-loudness-structure.md) | Chromagram and key templates, Camelot, BS.1770 loudness, novelty boundaries, cue suggestions |
| 5 | [Set planner](set-planner.md) | Transition scoring, energy arc, cue assignment, search, baselines, evaluation |
| 6 | [Data and storage](data-and-storage.md) | Python artifacts and cache identity, CLI workflows, reports, Supabase schema, import, measurement statuses |
| 7 | [Rekordbox bridge](rekordbox-bridge.md) | Reading Rekordbox XML, grid and cue conversion, comparison, safety rules |
| — | [Glossary](glossary.md) | Short definitions of every term used above |

## How each page is laid out

- A short summary, then the pipeline in order.
- For each stage: what it computes and why, inputs and outputs, the formula, the exact constants, and a **Code:** line naming the file and function. Line numbers are left out because they change often.
- Places where the Python and web versions differ are noted.
- A final **Limitations and open questions** section lists provisional thresholds, heuristics and known gaps.

## Keeping it current

These pages describe behaviour, so update them in the same commit as any change to a formula, threshold, default weight, schema or workflow. Each page's **Code:** lines show which files it depends on, so it is quick to find the pages a change affects:

```powershell
rg -l "key.ts" docs/how-it-works
```
