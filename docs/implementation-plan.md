# SetVector incremental build sequence

**Status:** Proposed sequence, pending the owner's choice of first milestone and target library.

The confirmed interface is a Python library and CLI with interactive charts. The steps below give a dependency order; they are not a commitment to implement the entire README before the first usable release. No application code is implemented by this documentation change.

## 0. Confirm the first release boundary

Answer the open questions in [the architecture](architecture.md): first desired outcome, supported operating systems, library size, audio formats, and music styles. Use these to choose fixtures, a listening collection, support guarantees, and measurable performance targets.

## 1. Package and data contracts

Create a tested Python environment, `pyproject.toml`, and `src/setvector/`. Add configuration and core result types, a CLI entry point, and development checks. Select compatible dependency versions through an actual clean install.

Done when the built package can be installed into a fresh environment, the CLI can show help, and a minimal contract round trip rejects invalid schemas/shapes.

Suggested commit: `chore(project): scaffold the Python package and development tools`

## 2. Ingestion and persisted feature measurements

Implement asset identity, supported-format checks, explicit decoding, and a small feature bundle with real timestamps and units. Add artifact storage, atomic publication, cache validation, and per-track diagnostics. Include silence and partial-window behavior from the start.

Done when supported local audio yields inspectable feature artifacts; rerunning unchanged input can reuse them; changed configuration invalidates the cache; invalid files fail clearly. Confirm numerical timing/units with synthetic signals.

Suggested commits:

- `feat(ingestion): identify and decode supported audio files`
- `feat(analysis): extract aligned track feature series`
- `feat(storage): persist versioned analysis artifacts`

## 3. First interactive report

Render raw feature curves with aligned time axes, units, beat estimates where available, and quality flags. Export a self-contained HTML report and document the library and CLI usage.

Done when a report opens locally without a network connection and can be regenerated from saved artifacts without reanalyzing audio. Inspect it on a representative real track and on silence.

Suggested commit: `feat(visualization): export interactive track analysis reports`

## 4. Energy experiment and calibration

Define the listening collection and annotations. Implement an explicitly named within-track baseline, then a separate calibration-fit operation and cross-track model. Persist transforms, population identity, weights, smoothing, contributions, and quality states.

Done when two results can be compared only under compatible model/profile semantics, scoring changes reuse features, and held-out listening judgments can be compared against simple baselines. Record observed results, including failures; do not call the model validated solely because the code passes tests.

Suggested commits:

- `feat(energy): add an explainable within-track baseline`
- `feat(energy): add frozen cross-track calibration profiles`
- `test(energy): evaluate baseline models against listening annotations`

This is the proposed first usable track-energy milestone. Change the release boundary if the owner prioritizes notebook experimentation or a complete set workflow instead.

## 5. Contextual transition comparison

Add explicit entry/exit regions, tempo assumptions, annotations, and directional feature comparisons. Introduce harmony/structure extraction only with defined semantics and evaluation examples. Display component measurements and unknown information rather than a universal transition quality score.

Done when A -> B can differ from B -> A for an explained reason, corrected metadata has provenance, and changing cue regions changes the compared data.

Suggested commit: `feat(transitions): compare explicit entry and exit regions`

## 6. Playlist and timed set analysis

First support ordered track summaries. Then add independent placement IDs, source trims, playback-rate mappings, overlaps, and a predicted set timeline. Compare a recorded mix only by analyzing that recording separately.

Done when repeated tracks, trimmed regions, gaps, and overlaps are represented correctly and reports clearly distinguish planned estimates from measured audio.

Suggested commit: `feat(playlists): model timed track placements and set curves`

## 7. Research-led extensions

Use measured bottlenecks to decide whether to add a catalog, process workers, or block processing. Use listening evidence to decide whether to add learned models, clustering, recommendations, and sequencing optimization. Each extension needs an explicit objective, evaluation method, and a small architecture decision record.

## Commit practice

Follow `../AGENTS.md`. Commit cohesive changes locally, inspect the staged diff, and run checks appropriate to the change. Use Conventional Commit subjects and optional explanatory bodies without trailers. Use `!` for a breaking change and explain it in the body. Do not include unrelated working-tree changes.

Commit examples above describe potential future changes; they are not a record of work already completed.
