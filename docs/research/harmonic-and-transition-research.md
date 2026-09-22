# Harmonic and Transition Research

## What the Camelot Wheel contributes

Camelot labels encode twelve major and twelve minor keys: `A` denotes minor and `B` major. The usual starting suggestions are the same code, one number clockwise or counterclockwise with the same letter, or the same number across A/B. For example, `8A` suggests `8A`, `7A`, `9A`, and `8B`, with the numbers wrapping at 12. [Mixed In Key's guide](https://mixedinkey.com/workflows/how-to-mix-in-key/) also recommends checking BPM, energy, groove, vocals, and arrangement, and listening to the result. The wheel is a candidate-generation heuristic, not a measurement of transition quality or an energy model.

The relevant question for a DJ transition is what sounds **during the proposed overlap**. A percussion-only cut can make global-key distance nearly irrelevant; a long melodic blend can make it important. The engine should therefore score a declared transition type and region, and explain when key evidence is unavailable. It should not reject every non-neighboring Camelot pair or promise that a wheel move raises energy. This is an engineering inference from the wheel's limited representation and from region-aware transition research. [Bittner et al.](https://archives.ismir.net/ismir2017/paper/000086.pdf) select transition points using downbeats, structural boundaries, and local pitch and timbre; [Vande Veire and De Bie](https://link.springer.com/article/10.1186/s13636-018-0134-8) combine key, structure, and cue regions in a genre-specific DJ system.

## Key evidence for a mixed collection

An estimator's output depends on its training repertoire and tonal assumptions. A cross-genre key-estimation study found that a model tuned to pop performed worse on electronic music, including relative and parallel mode errors. [Korzeniowski and Widmer](https://arxiv.org/abs/1706.02921) The [Essentia Key documentation](https://essentia.upf.edu/reference/streaming_Key.html) describes multiple profiles and explicitly says its `edmm` profile reports major modes as minor to improve other EDM results. It would be a poor universal default for House, Hip-hop, Pop, EDM, BollyHouse, and Bollywood together.

These studies do not establish how SetVector's Bollywood originals or BollyHouse edits behave. Film songs and remixes should be measured directly rather than inferred from Indian classical music or from a style label. Store overlapping style tags and evaluate originals, edits, vocal sections, and percussion-heavy sections separately. A track may be tonal yet not fit a single stable major/minor label; in that case keep a useful tonal summary or mark the Camelot code unknown. No verified Bollywood/BollyHouse key benchmark has yet been identified for this intended collection.

For a transparent local baseline, compare chroma and candidate major/minor templates on annotated tracks, rather than selecting a profile by reputation. [librosa 0.11](https://librosa.org/doc/0.11.0/generated/librosa.feature.chroma_cqt.html) provides constant-Q chroma; [Essentia](https://essentia.upf.edu/reference/std_Key.html) exposes key strength and a best-versus-second estimate comparison. Those strengths are algorithm diagnostics, **not calibrated probabilities** that a key label or DJ transition is correct. Keep the estimated tonic and mode, alternatives, profile identity, tuning information, and user correction separately. Derive a Camelot display code only when the chosen tonic/mode representation supports it.

Analyze likely entry and exit regions as well as the whole track. Local pitch-class profiles can reveal changes or uncertain passages that one global code hides. Chroma can also help find repeated sections; [librosa's CENS variant](https://librosa.org/doc/0.11.0/generated/librosa.feature.chroma_cens.html) smooths and normalizes chroma for structural comparison. Its normalized values are not an energy measurement. All new outputs need timestamps, validity, configuration and algorithm identity, and a separate artifact or compatible schema version so existing baseline feature caches remain interpretable.

## Rhythm, structure, and cue points

SetVector currently stores global tempo and beat positions but no pulse confidence, downbeats, meter, or phrases. [librosa's beat tracker](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html) returns beat events and a tempo estimate; it does not make every fourth beat a verified bar line. Candidate half/double tempo interpretations, timing drift, and user-corrected beat phase should remain visible. A suggested cue must not present an assumed 4/4 or 8/16/32-bar boundary as detected fact. [Traktor's documentation](https://docs.native-instruments.com/ni-tech-manuals/traktor-play-user-guide/en/beat-matching-and-sync) likewise distinguishes tempo synchronization from phase synchronization, reinforcing why BPM proximity is insufficient for a beatmatched cue.

Structure algorithms can propose boundaries but need listening checks. For example, [librosa's agglomerative segmenter](https://librosa.org/doc/0.11.0/generated/librosa.segment.agglomerative.html) partitions features into contiguous segments; the output is not automatically a verse, drop, or phrase label. The Drum and Bass DJ study reports strong annotations for its restricted genre and also notes errors in vocal detection and key estimation. Its structural accuracy does not transfer automatically to six styles. [Vande Veire and De Bie](https://link.springer.com/article/10.1186/s13636-018-0134-8)

A proposed directional transition should record at least:

| Field | Why it matters |
|---|---|
| A exit interval and B entry interval | Local features can differ from whole-track summaries |
| Transition type and planned overlap | A cut, short fade, and long blend impose different harmonic and rhythmic demands |
| Playback tempo, beat phase, meter, and key-lock assumption | BPM proximity alone does not establish beat alignment or the sounding pitch |
| Local tonal evidence and its uncertainty | The wheel is most useful when melodic material overlaps |
| Energy, bass, timbre, and vocal activity by region | Compatible keys can still yield a crowded or awkward blend |
| Cue provenance | Distinguishes manually approved cues from estimated boundaries |

Adjacent pair choices interact: B's entry cue from A → B must leave a valid played span before B's exit cue for B → C. Planning must carry cue state across the sequence or validate and repair it jointly. A collection of individually best pair transitions can otherwise produce an impossible set.

The output should name the evidence and its limits, for example: “same Camelot key; about 3% tempo adjustment; exit phrase unverified; short blend suggested.” When a beat grid or key is uncertain, offer a cut or a review-needed cue rather than claiming a seamless beatmatched overlap.
