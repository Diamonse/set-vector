# Rekordbox rhythm comparison

This directory preserves a local comparison of a Rekordbox XML export with SetVector's rhythm engine. Open [the comparison dashboard](rekordbox-setvector-comparison.html) for per-track beat and downbeat results. [The collection dashboard](rekordbox-collection.html) lists the XML records and their metadata. `collection-comparison.json` contains the underlying track records, expanded grids, matches, and summary; the Python and CSS files preserve the scripts used to build the snapshot.

The XML had 185 records: 150 songs, 30 short samples, and five missing audio locations. SetVector analyzed all 180 available files. Among songs, 98 selected Beat This!, 44 selected the fallback beat grid, and eight abstained. At a 40 ms tolerance, 107 of 142 songs with a reliable SetVector grid had both beat precision and Rekordbox coverage of at least 95%; at 80 ms, 118 of 142 did. The comparison uses chronological one-to-one matching. Read the dashboard's track details for the exact beat and downbeat counts and timing differences.

Rekordbox grids are a useful comparison, but are not manually verified ground truth. A disagreement can come from either grid, including bar phase, tempo interpretation, and sparse Rekordbox tempo markers. The proposed validation and improvement work is in [the design](../../docs/superpowers/specs/2026-09-24-rhythm-accuracy-improvements.md) and [implementation plan](../../docs/superpowers/plans/2026-09-24-rhythm-accuracy-improvements.md).

This snapshot includes track names, metadata, and local audio paths. It contains no audio files or model weights. The generator scripts retain the source machine's paths to the XML and analysis workspace; the HTML and JSON are self-contained reference artifacts.
