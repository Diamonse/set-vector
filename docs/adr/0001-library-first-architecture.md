# ADR-0001: Build a reusable local Python analysis package

**Status:** Proposed; the owner has confirmed Python library, CLI, and interactive charts as the first interface.
**Date:** 2026-09-21
**Decider:** Repository owner

## Context

SetVector is an experimental open-source DJ assistance project. Its README describes audio features, energy curves, transitions, and eventual set planning. There is no implementation yet, and the energy model is explicitly an area of research.

The design must support repeated experimentation without coupling algorithms to a UI or rerunning expensive feature extraction for every model change. Workload, format support, and first milestone still need confirmation.

## Decision

Propose a single installable Python package with separate analysis, energy, application, storage, visualization, and interface modules. CLI and notebooks use the same application services. Persist versioned raw features independently from calibration and energy results. Generate local interactive HTML reports.

Keep raw measurements, within-track dynamics, and cross-track scores distinct. A cross-track score identifies its calibration profile and model; comparisons require compatible identities.

## Options considered

| Option | Complexity and cost | Growth path | Assessment |
|---|---|---|---|
| Python package + CLI + reports | Modest implementation scope; local compute and storage | Add a UI or workers around established services | Fits the confirmed interface and experimental core |
| Notebook-only prototype | Quick experiments; increasing reproducibility and reuse burden | Requires extracting a package before reliable CLI/app use | Useful client of the package, insufficient as the sole product structure |
| Local visual app first | More UI and packaging work before validating analysis | Reuse the same core later | Reasonable later if visual workflows become the priority |
| Hosted service first | Hosting, uploads, accounts, and asynchronous job operations | Supports shared access | Adds requirements outside the confirmed initial interface |

Team familiarity is not yet established. No quantitative cost, throughput, or delivery-time claim is made.

## Consequences

- Model experiments can reuse stored features and be compared reproducibly.
- Raw numerical code can be tested independently of the CLI and charts.
- A later UI can use existing application services and artifacts.
- Early users need a Python environment and local audio files.
- Artifact schemas, migration/rejection policy, and model identities require deliberate maintenance.
- Codec support and peak memory must be validated on the intended machines and workload.

## Next actions

1. Resolve the first milestone and target library questions recorded in `../architecture.md`.
2. Establish one tested Python environment and scaffold the package.
3. Deliver ingestion, a minimal feature bundle, and a raw-feature report as a vertical slice if that matches the chosen milestone.
4. Validate calibration and an interpretable energy baseline before promising cross-track energy comparisons.
