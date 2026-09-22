# Interactive Track Report

## Objective

Render one saved feature artifact as a self-contained HTML page that serves two readers equally:

- a DJ exploring where a track builds, breaks, and drops while listening to it;
- a developer checking that the measurements are believable, aligned, and traceable.

```text
feature ID + workspace
  -> stored AudioAsset and FeatureBundle (no reanalysis)
  -> optional verified audio preview
  -> report model
  -> single HTML file
```

The report displays measurements only. Energy scores, downbeat detection, multi-track comparison, and annotations are later stages.

## Offline requirement

Rendering and viewing need no network access, GPT model, API key, cloud service, or telemetry. Every script, stylesheet, font, data array, and audio byte is inlined into the HTML file. The page makes no requests beyond its own `data:` and `blob:` URLs.

## Command

```text
setvector report <feature-id> --workspace <directory>
    [--output <file.html>] [--audio <path> | --no-audio] [--overwrite]
```

- The default output is `<workspace>/reports/<feature-id>.html`. Parent directories are created.
- Standard output is one JSON object: `report_path` (absolute), `feature_id`, and `audio` (`"embedded"` or `"none"`).
- An existing output file is replaced only with `--overwrite`.
- Features are read from the stored artifact. Audio is never reanalyzed.

## Audio embedding

The audio source is `--audio` when given, otherwise the `observed_path` recorded in the stored `asset.json`. The file's SHA-256 must equal the artifact's `asset_id`; a different file is rejected rather than embedded under the wrong analysis.

- MP3 content is embedded byte-for-byte.
- Other decodable content (WAV, FLAC, AIFF, OGG) is decoded at its native rate and channel count and encoded in memory to MP3 with SoundFile, so it plays in every current browser. The source file is never modified.
- `--no-audio` produces a report without a player. It is the explicit choice when the audio is unavailable.

Reports with audio carry the music and are as large as the MP3 plus about a third for base64 encoding. The documentation notes this before sharing.

## Report contents

The layout follows the approved interactive mockup.

1. **Header.** Artist and title parsed from the filename's `Artist - Title` form, otherwise the whole filename as the title. A secondary line shows format, sample rate, channels, length, and detected beat count.
2. **Stat cards.**
   - Tempo, labeled as estimated, or "not detected".
   - Length, with an approximate bar count (`≈ 168 bars`) derived from the tempo and 4/4, because downbeats are not detected.
   - Bass: a display band word (Light, Moderate, Heavy), the median share of power at or below 250 Hz, and a meter.
   - Brightness: a display band word (Dark, Balanced, Bright), the median spectral centroid in kHz, and a meter.
   - Each band's tooltip gives the exact value and states that the bands are fixed display ranges, not calibrated judgments.
3. **Player and overview.** A large play/pause button (space bar toggles) and elapsed/total time. A whole-track overview canvas draws mirrored bars whose height is the RMS peak and whose color is the mean bass ratio in each pixel column. A legend explains the encoding. Clicking the overview seeks. Played and unplayed regions are visually distinct. A frame shows the close-up window.
4. **Close-up.** Four synchronized uPlot lanes on one time window:

   | Lane | Series | Display |
   |---|---|---|
   | Level | `rms` | RMS value; tooltip states it is not LUFS |
   | Bass | `bass_power_ratio` | percent of power |
   | Brightness | `spectral_centroid` | kHz |
   | Hits | `onset_strength` | percent of this track's peak |

   - Zoom presets are 8, 16, 32, and 64 bars at the detected tempo. Without a tempo, they are 10, 20, 40, and 80 seconds.
   - A "Follow playback" toggle keeps the playhead inside the window.
   - Beat lines are faint; every fourth detected beat, counted from the first, is stronger and labeled as unconfirmed bar lines in the details.
   - Hovering any lane shows a shared cursor and the values of all four lanes at that time. Clicking a lane seeks.
   - Missing observations are gaps, never zeros.
5. **Warnings notice.** Diagnostics warnings appear in a visible notice above the close-up when present.
6. **About this analysis.** Collapsed by default. It lists extractor and package version, frame and hop lengths, channel policy, frames measured, omitted tail samples, warnings, feature ID, asset ID, and dependency versions, followed by the limitations: tempo is a candidate estimate, bars assume 4/4 without detected downbeats, Level is not LUFS, and Hits are normalized per track.

Typography uses the Inter variable font at weights 400 to 700 with tabular numerals, falling back to `system-ui`. The page follows the system color scheme and offers a Dark/Light toggle; the choice is remembered with `localStorage` when available. The page is usable from 360 px wide upward.

## Report model

`ReportModel` is an immutable, JSON-ready description built by a pure function from `(AudioAsset, FeatureBundle)`:

- identity: `feature_id`, `asset_id`, `schema_version`
- `title`, `artist` (optional), `format_line`
- `duration_seconds`, `tempo_bpm` (optional), `beats` (seconds), `downbeats` (empty list; reserved for the downbeat stage)
- `timestamps`: one base64-encoded little-endian `float64` array of frame-center times shared by all series
- `series`: for each of the four features, `name`, `unit`, and a base64-encoded little-endian `float32` value array with NaN where validity is false
- `summary`: medians of valid values, band words, bar estimate, or `None` where no valid value exists
- `warnings` and a list of labeled provenance facts

Series keep every stored frame. A one-hour recording is about 370,000 frames and about 7 MB of encoded data, which uPlot renders; the overview bins data to its pixel width in the browser. Window boundaries remain in the stored artifact and are not needed for display.

## Module boundaries

| Unit | Responsibility |
|---|---|
| `storage.ArtifactStore.load_stored(feature_id)` | Return the stored `AudioAsset` and `FeatureBundle` with the same validation as `load`, without inspecting audio. Malformed or unknown IDs raise `InputError`; invalid artifacts raise `ArtifactError`. |
| `storage.write_report(path, html, overwrite)` | Write UTF-8 through a temporary sibling file and atomic replace. Refuse an existing target unless `overwrite`. |
| `ingestion.load_preview(path, asset)` | Verify content identity, then return `PreviewAudio(mime_type, data)`: MP3 bytes unchanged or an in-memory MP3 encode. |
| `visualization.model` | Build `ReportModel`. No filesystem access. |
| `visualization.html` | Fill the template with inlined assets, the model JSON, and optional audio. Escape all text. Embed JSON so `</script>` cannot terminate the script element. |
| `visualization/assets/` | `report.html`, `report.css`, `report.js`, vendored uPlot 1.6.32 (`uPlot.iife.min.js`, `uPlot.min.css`), the Inter variable font from `@fontsource-variable/inter` 5.3.0 (`inter-latin-wght-normal.woff2` and `inter-latin-ext-wght-normal.woff2`), and `LICENSES/` with uPlot's MIT and Inter's OFL 1.1 texts. Loaded with `importlib.resources` so they ship in the wheel. |
| `application.render_report(feature_id, store, output, audio, include_audio, overwrite)` | Coordinate loading, preview, model, rendering, and writing. Return `ReportOutcome(report_path, feature_id, audio_embedded)`. |
| `cli` | Parse options, map errors to exit codes, and print JSON. |

Visualization never decodes audio or recomputes features. The browser code reads only the embedded model and audio.

In the browser, the embedded audio is converted once to a `Blob` URL. The `<audio>` element is the single clock: its current time drives the overview playhead, the close-up window, and the uPlot cursor.

## Errors

Expected failures print `error:` messages without tracebacks and leave no partial report.

| Situation | Exit |
|---|---|
| Unknown feature ID, invalid arguments, both `--audio` and `--no-audio`, existing output without `--overwrite` | 2 |
| Audio missing at the recorded path; the message suggests `--audio <path>` or `--no-audio` | 2 |
| Audio content hash differs from the asset ID | 2 |
| Corrupt or incomplete artifact, audio decode or encode failure, report write failure | 1 |

## Edge cases

- Silent or all-missing series render as "no signal" lanes, and summary cards show "—".
- A clip shorter than one frame produces an empty close-up with its warning shown.
- Without beats, tempo shows "not detected", zoom uses seconds, and no beat lines are drawn.
- Filenames without ` - `, with Unicode, or with HTML characters display safely.

## Documentation updates

- `docs/architecture.md`: replace the Plotly recommendation with inlined uPlot plus custom canvas code, citing size and the approved interaction design.
- `docs/development.md` and `README.md`: document the `report` command, audio embedding and its sharing implications, and the offline guarantee.
- `docs/implementation-plan.md`: describe the implemented Step 3 without claiming energy scoring.

## Verification

- Model: base64 float32 round trip with NaN gaps, medians and bands, bar estimate, title parsing, silence, empty series, and no-beat cases.
- HTML: no `http://`, `https://`, or protocol-relative references in `src`, `href`, `url(...)`, or `@import`; uPlot, Inter, and model data embedded; a hostile title escaped; the no-audio report stays under 2 MB for a 6-minute track.
- Preview: MP3 bytes pass through unchanged; WAV becomes MP3 that decodes to the source duration within one MP3 frame; missing files and hash mismatches raise the documented errors.
- Storage: `load_stored` success and failures, atomic report writes, overwrite refusal, and `--overwrite`.
- CLI: success JSON and every exit code in the error table, including an end-to-end `analyze` then `report`.
- Offline: `analyze` and `report` succeed with Python socket connections blocked.
- JavaScript: `node --check` on the template scripts when Node is available; the test is skipped otherwise.
- Manual: render reports for a representative real MP3 and a silent WAV, and open them with networking disabled before completing the stage.
