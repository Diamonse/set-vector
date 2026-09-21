# SetVector
**Mathematical track analysis and energy-aware DJ set planning.**

SetVector is an open-source project exploring how audio analysis, mathematical modeling, and data-driven techniques can be used to understand the energy and flow of DJ sets.

The goal is to build tools that help DJs analyze tracks, visualize changes in musical energy, compare transitions, and eventually plan sets around intentional energy curves rather than relying only on BPM or key.

## Why SetVector?

Most DJ software provides useful technical information such as BPM, key, waveform structure, and beat grids.

However, two tracks with similar BPM and compatible keys can still feel completely different on a dance floor.

SetVector explores a broader question:

**Can we mathematically represent how a track feels within the energy progression of a DJ set?**

The project aims to combine traditional DJ metadata with audio-derived features to create a more useful representation of track and set energy.

## Project Goals

SetVector is being developed around several core ideas:

- Analyze musical and audio features that contribute to perceived energy
- Create numerical representations of track energy
- Visualize energy changes throughout individual tracks
- Compare the energy relationship between two tracks
- Evaluate potential transitions
- Model the energy curve of an entire DJ set
- Experiment with mathematical and machine-learning approaches to set construction
- Build tools that complement rather than replace a DJ's creative judgment

## Potential Features

Planned areas of experimentation include:

### Track Analysis

Extract and analyze features such as:

- BPM
- Musical key
- Loudness
- Dynamic range
- Spectral characteristics
- Bass intensity
- Rhythmic density
- Percussive activity
- Structural changes
- Build-ups and drops

### Energy Modeling

Represent track energy as a numerical score or time-dependent function.

For example:

```text
Track
  ↓
Audio Features
  ↓
Feature Normalization
  ↓
Energy Model
  ↓
Energy Score / Energy Curve
```

Rather than assigning only a single number to a track, SetVector may model energy as a function over time:

```text
E(t)
```

This makes it possible to distinguish between tracks that gradually build, peak early, remain constant, or contain multiple drops.

### Transition Analysis

Future versions may estimate how two tracks interact based on features such as:

```text
Δ Energy
Δ BPM
Key Compatibility
Rhythmic Similarity
Spectral Similarity
Track Structure
Phrase Position
```

This could eventually produce a transition representation such as:

```text
Track A
   ↓
Transition Analysis
   ↓
Track B

Energy:        0.68 → 0.81
BPM:           126 → 128
Key:           Compatible
Energy Change: +0.13
```

The objective is not to automatically decide whether a transition is "good."

Instead, the system should provide useful information that DJs can incorporate into their own creative decisions.

## Set Energy Curves

One of the longer-term goals of SetVector is to represent the progression of an entire DJ set.

For example:

```text
Energy
1.0 |                         ╭─────╮
    |                    ╭────╯     ╰──╮
0.8 |             ╭──────╯              │
    |        ╭────╯                     ╰─╮
0.6 |   ╭────╯                            │
    |╭──╯                                 │
0.4 |╯                                    ╰──
    +-----------------------------------------
       Track 1   2   3   4   5   6   7   8
```

Different sets may intentionally follow very different curves.

Examples could include:

- gradual build
- peak-time set
- wave-like progression
- high-energy sustained set
- opening set
- closing set

SetVector aims to analyze these patterns without assuming there is a single "correct" way to structure a DJ set.

## Mathematical Direction

The project will experiment with several approaches to energy representation.

A simplified model could take the form:

```text
E = w₁x₁ + w₂x₂ + ... + wₙxₙ
```

where:

- `xᵢ` represents an extracted audio feature
- `wᵢ` represents the contribution of that feature to perceived energy

More advanced versions may use:

- time-series analysis
- dimensionality reduction
- clustering
- similarity metrics
- optimization
- signal processing
- machine learning
- learned embeddings

The exact energy model is still an active area of experimentation.

## Philosophy

SetVector is intended to be a **DJ assistance tool, not an automated DJ replacement**.

DJing involves context, crowd response, creativity, taste, timing, and improvisation that cannot be reduced to a single metric.

The purpose of SetVector is to surface information that existing DJ software does not always make obvious.

Think of it as:

```text
DJ intuition
     +
musical information
     +
mathematical analysis
     =
better-informed creative decisions
```

## Architecture

See the [Architecture](docs/architecture.md),
[Python Library Architecture](docs/adr/0001-library-first-architecture.md), and
[Implementation Plan](docs/implementation-plan.md) for the design and build sequence.

The first interface will be a Python library and CLI with interactive charts.
Planned package layout:

```text
set-vector/
│
├── pyproject.toml
├── AGENTS.md
├── src/
│   └── setvector/
│       ├── domain/
│       ├── ingestion/
│       ├── analysis/
│       ├── energy/
│       ├── application/
│       ├── storage/
│       ├── visualization/
│       ├── cli/
│       ├── transitions/       # later milestone
│       └── playlists/         # later milestone
│
├── notebooks/
│   ├── experiments/
│   └── research/
│
├── tests/
│
├── examples/
│
├── docs/
│   ├── architecture.md
│   ├── implementation-plan.md
│   └── adr/
│
├── LICENSE
└── README.md
```

The project structure will evolve as the system develops.

## Roadmap

### Phase 1 — Track Analysis

- [ ] Audio file ingestion
- [ ] BPM extraction
- [ ] Key detection
- [ ] Loudness analysis
- [ ] Spectral analysis
- [ ] Rhythmic feature extraction

### Phase 2 — Energy Representation

- [ ] Initial energy metric
- [ ] Feature normalization
- [ ] Track-level energy score
- [ ] Time-dependent energy curve
- [ ] Energy visualization

### Phase 3 — Transition Analysis

- [ ] Track similarity metrics
- [ ] Energy-change analysis
- [ ] Harmonic compatibility
- [ ] Transition feature vector
- [ ] Transition visualization

### Phase 4 — Set Analysis

- [ ] Playlist/set ingestion
- [ ] Full-set energy curve
- [ ] Energy progression statistics
- [ ] Set comparison tools
- [ ] Identify peaks, valleys, and major energy shifts

### Phase 5 — Intelligent Set Planning

Potential future research areas:

- transition recommendations
- track sequencing
- target energy curves
- constrained set optimization
- ML-based energy models
- personalized DJ style modeling

## Open Source

SetVector is intended to encourage experimentation at the intersection of:

- DJing
- music information retrieval
- signal processing
- mathematics
- data science
- machine learning

Contributions, experiments, alternative models, and discussions are welcome.

## License

This project is licensed under the **Apache License 2.0**.

You are free to use, modify, and distribute the software in accordance with the terms of the license.

See [`LICENSE`](LICENSE) for details.

## Disclaimer

SetVector is an experimental software and research project.

Energy scores, transition metrics, and other outputs are analytical estimates and should not be interpreted as objective measures of musical quality.

DJ selection and mixing remain creative decisions made by the DJ.

## Author

Built by **Aryan / λRYN** as an exploration of the intersection between mathematics, software, and DJing.

---

**SetVector**

*Model the track. Understand the energy. Shape the set.*
