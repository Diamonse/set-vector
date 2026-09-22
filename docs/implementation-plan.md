# Implementation Plan

Build a Python library and CLI with interactive charts in the dependency order below. The first release boundary depends on the target workflow and audio library.

## 0. Release scope

Define the first release's target workflow, supported operating systems, library size, audio formats, and music styles. Use these to choose fixtures, a listening collection, support guarantees, and measurable performance targets. See [Architecture](architecture.md) for the system design.

## 1. Package and data contracts

Create a tested Python environment, `pyproject.toml`, and `src/setvector/`. Add configuration and core result types, a CLI entry point, and development checks. Select compatible dependency versions through an actual clean install.

Done when the built package can be installed into a fresh environment, the CLI can show help, and a minimal contract round trip rejects invalid schemas/shapes.

## 2. Ingestion and persisted feature measurements

Implement asset identity, supported-format checks, explicit decoding, and a small feature bundle with real timestamps and units. Add artifact storage, atomic publication, cache validation, and per-track diagnostics. Include silence and partial-window behavior from the start.

Detailed design: [Audio Analysis Pipeline](superpowers/specs/2026-09-22-audio-analysis-pipeline-design.md).

Done when supported local audio yields inspectable feature artifacts; rerunning unchanged input can reuse them; changed configuration invalidates the cache; invalid files fail clearly. Confirm numerical timing/units with synthetic signals.

## 3. First interactive report

Render raw feature curves with aligned time axes, units, beat estimates where available, and quality flags. Export a self-contained HTML report and document the library and CLI usage.

Done when a report opens locally without a network connection and can be regenerated from saved artifacts without reanalyzing audio. Inspect it on a representative real track and on silence.

## 4. Energy experiment and calibration

Define the listening collection and annotations. Implement an explicitly named within-track baseline, then a separate calibration-fit operation and cross-track model. Persist transforms, population identity, weights, smoothing, contributions, and quality states.

Done when two results can be compared only under compatible model/profile semantics, scoring changes reuse features, and held-out listening judgments can be compared against simple baselines. Record observed results, including failures; do not call the model validated solely because the code passes tests.

This step provides a usable track-energy workflow. The first release may end earlier for notebook experimentation or include later steps for a complete set workflow.

## 5. Contextual transition comparison

Add explicit entry/exit regions, tempo assumptions, annotations, and directional feature comparisons. Introduce harmony/structure extraction only with defined semantics and evaluation examples. Display component measurements and unknown information rather than a universal transition quality score.

Done when A -> B can differ from B -> A for an explained reason, corrected metadata has provenance, and changing cue regions changes the compared data.

## 6. Playlist and timed set analysis

First support ordered track summaries. Then add independent placement IDs, source trims, playback-rate mappings, overlaps, and a predicted set timeline. Compare a recorded mix only by analyzing that recording separately.

Done when repeated tracks, trimmed regions, gaps, and overlaps are represented correctly and reports clearly distinguish planned estimates from measured audio.

## 7. Research-led extensions

Use measured bottlenecks to decide whether to add a catalog, process workers, or block processing. Use listening evidence to decide whether to add learned models, clustering, recommendations, and sequencing optimization. Each extension needs an explicit objective, evaluation method, and a small architecture decision record.
