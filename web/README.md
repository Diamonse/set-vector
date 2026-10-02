# SetVector Web

A web app for keeping reviewed track evidence and planning DJ sets or listening playlists from it. It is built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui components, and Supabase for authentication and storage.

The web app is optional and sits beside the offline Python analyzer. It analyzes audio files in the browser, so no audio is ever uploaded: only the measurements you choose to save are stored. You can also enter or import metadata (duration, tempo, key, relative energy, cue regions). The planner runs in TypeScript on the server. The offline analysis path in `src/setvector` does not depend on the web app.

## Features

- **First-load intro:** the first time the site opens in a browser tab, the 3D CDJ plays full-screen for 3 seconds while the page loads underneath, then fades out. Any click or key, or **Skip intro**, ends it early; reduced motion gets a 1.2 second still frame. It shows once per tab session (`sessionStorage`). The timing runs in a script in `<head>` (`src/lib/intro.ts`) so it does not wait for the app to hydrate.
- **Home dashboard:** signing in lands on **Home** (`/home`): quick actions, a getting-started checklist that ticks off from your data and hides when done, library health (tempo, key, energy, and cue coverage, with a link to the tracks that need review), charts of tempo, keys on the Camelot wheel, energy, and styles (each with a data table), and recent plans, analyses, and changes. The public page at `/` sends signed-in visitors to Home.
- **Filtering and sorting:** click any Library column header to sort by it (again to reverse). A filter row under the headers narrows by title or artist, style, BPM range (optionally at half or double time), Camelot key (exact, or keys that mix with it: same, adjacent, relative), energy range, length range, and cue-region state; filters combine. The track picker for plans and crates has the same filters and a sort menu. The rules live in `src/lib/library/filters.ts`.
- **Library:** tracks with style tags, remix family, tempo and alternative tempos, key with a status (reviewed, estimated, uncertain, not meaningful), relative energy on a 1 to 10 scale, and analyzer asset and feature IDs. Every value records whether it is an estimate or a reviewed decision.
- **Cue regions:** entry and exit intervals `[start, end)` with review status and vocal activity. The database rejects regions that extend past the track.
- **Revisions:** track edits, cue changes, plan edits, and transition judgments are appended to an `annotations` table. Each revision points to the one it supersedes, and nothing is overwritten.
- **Audio analysis in the browser:** drop audio files on **Library > Analyze audio** to measure tempo (with half, double, and other alternatives), a beat grid, downbeats (with the model), key with a confidence margin, BS.1770 loudness, section boundaries, and up to three phrase-aligned entry and exit cue suggestions each. Results are saved as estimates; values you reviewed are never overwritten. See [Audio analysis](#audio-analysis).
- **Waveform and cue editing:** on a track's **Audio and analysis** tab, open your local copy of the file to play it, see beat and downbeat markers, drag to create or resize cue regions snapped to beats, and approve or reject suggestions.
- **Import:** JSON or CSV with a local preview before upload (see `examples/`).
- **Rekordbox import:** read a Rekordbox collection export in the browser, choose tracks, and add them with their tempo markers and cue points. Cues become approved entry and exit regions for planning, and tracks without usable cues get phrase-aligned suggestions from the Rekordbox grid. The grid and cue points also appear on the track's waveform. See [Rekordbox import](#rekordbox-import).
- **Automatic energy estimates:** analyzed tracks without your own rating get a 1 to 10 energy estimate ranked against your library. See [Energy estimates](#energy-estimates).
- **Crates:** saved track selections, used as fixed lists or as pools.
- **Light and dark themes:** follows the system setting, with a Light, Dark, or System switch in the top bar that is remembered in the browser. Colors are CSS variables in `src/app/globals.css`; fonts (Unbounded, Instrument Sans, JetBrains Mono) are bundled at build time by `next/font`, so no font request leaves the app at runtime.
- **Planner:**
  - Modes: DJ preparation and listening flow.
  - Selection: use every track, or choose from a pool to a target count or duration.
  - Constraints: required and excluded tracks, opening and closing anchors, a repeat policy, and artist or remix spacing.
  - Energy arc: a preset or custom target scored against elapsed planned playback time.
- **Plan review:**
  - Explanations: each directional transition lists its key relation, tempo change, cue provenance, energy step, vocal overlap, suggested type (cut, short blend, long blend), and the cost of each score component.
  - Energy arc chart with a data table.
  - Alternatives and constraint violations.
  - Comparison with random, BPM-sorted, Camelot-walk, and greedy orderings, plus an exhaustive optimum for crates of up to 8 tracks.
  - Live re-scoring while you edit the order.
  - CSV and JSON export, plus an M3U8 playlist for Rekordbox's File > Import > Import Playlist. Each line is the file path from the track's Rekordbox link; tracks without one (browser uploads) are written as comments and listed in a warning on the plan page.

## Planner design

The planner lives in `src/lib/planner` and has no framework or network dependencies. It follows the research notes in `docs/research`:

1. **Directional transitions** (`transition.ts`): A's exit region into B's entry region. Tempo matching allows half or double time and stored alternative tempos. With key lock off, harmonic comparison uses B's sounding key. Missing key, tempo, energy, or vocal evidence gets a neutral cost and a `missing` status, never zero.
2. **Joint cue assignment** (`evaluate.ts`): a Viterbi pass chooses entry and exit regions along the whole order, so each middle track keeps a valid played span. DJ duration counts played spans and overlaps. Listening duration counts whole tracks.
3. **Objective:** mean transition cost, plus the worst transition (so one bad pair is not hidden), plus arc deviation, diversity, a duration penalty, and hard-constraint penalties.
4. **Search** (`search.ts`): a multi-start beam search, then swap and relocate moves. Pool mode also uses replace, add, and remove moves. Large pools are pruned while keeping required tracks and every energy band. Everything is deterministic for a given seed and bounded by a time budget.

The default weights in `defaults.ts` are declared assumptions, not fitted values. Scores are heuristics for review, not judgments of musical quality. If the search fails to satisfy a constraint, that does not prove the request is infeasible.

Measured on synthetic data: planning a 3-hour set from a 2,000-track pool takes about 2.5 seconds (the default budget) in either mode.

## Directory structure

```text
web/
├── examples/                  Sample JSON and CSV imports
├── scripts/                   Model export, parity fixtures, ONNX Runtime asset copy
├── supabase/migrations/       Schema, triggers, and row level security
├── src/
│   ├── proxy.ts               Session refresh and route protection (Next.js 16 proxy)
│   ├── app/
│   │   ├── (auth)/            Sign-in and sign-up pages
│   │   ├── (app)/             Library, crates, and plans (signed-in area)
│   │   ├── actions/           Server actions (auth, tracks, cues, import, rekordbox, crates, plans)
│   │   └── auth/confirm/      Email confirmation handler
│   ├── components/
│   │   ├── ui/                shadcn/ui primitives styled with SetVector tokens
│   │   ├── app/               Shared page components
│   │   ├── analysis/ library/ crates/ plans/
│   ├── lib/
│   │   ├── analysis/          Browser audio analysis (worker, Beat This! via ONNX Runtime Web)
│   │   ├── domain/            Types, Camelot and key parsing, formatting
│   │   ├── planner/           Planning engine (pure TypeScript)
│   │   ├── import/            JSON and CSV import parser
│   │   ├── rekordbox/         Rekordbox XML reader and grid expansion (port of src/setvector/rekordbox)
│   │   ├── data/              Row mapping, queries, annotation writer
│   │   ├── supabase/          Server client, proxy helper, environment
│   │   └── validation/        Zod schemas
└── tests/                     Vitest tests: planner, keys, import, analysis and Rekordbox parity, model
```

## Local setup

Requirements: Node.js 20.9 or newer and a Supabase project.

1. Install dependencies:

   ```bash
   cd web
   npm install
   ```

2. Create the database schema. In the Supabase dashboard, open **SQL Editor**, then paste and run each file in `supabase/migrations/` in filename order. A project set up before audio analysis existed needs only the newer files; the analysis page reports when `track_analyses` is missing. Alternatively, with the Supabase CLI linked to your project, run:

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

3. Configure authentication. Under **Authentication > URL Configuration**, set the Site URL to your app origin (for example `http://localhost:3000`) and add `http://localhost:3000/auth/confirm` to the redirect URLs. If you keep email confirmation enabled, new users confirm through that link before signing in.

4. Set environment variables:

   ```bash
   cp .env.example .env.local
   ```

   | Variable | Required | Description |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL, from **Project Settings > API**. |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable key (`sb_publishable_...`) or the legacy anon key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted. Never use the service role or secret key. |
   | `NEXT_PUBLIC_SITE_URL` | No | Public origin used in confirmation emails. Defaults to `http://localhost:3000`. |
   | `NEXT_PUBLIC_BEAT_MODEL_MANIFEST_URL` | No | Where the browser finds the Beat This! model manifest. Defaults to `/models/beat_this-final0.json`. See [Beat detection model](#beat-detection-model). |
   | `NEXT_PUBLIC_BEAT_MODEL_SHA256` | No | Pins the model's SHA-256; the browser refuses any other file. |

   `NEXT_PUBLIC_` values are compiled into the build, so rebuild after changing them.

5. Run the app:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000, create an account, and import `examples/library.sample.json` to try the planner.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Generate route types and run the TypeScript compiler |
| `npm test` | Vitest unit and parity tests |
| `npm run test:model` | Runs an exported ONNX model through the browser pipeline and compares it with PyTorch (needs `BEAT_MODEL_PATH` and `BEAT_MODEL_REFERENCE`) |
| `npm run fixtures` | Regenerates the analysis and Rekordbox parity fixtures from the CLI's Python code |
| `npm run check` | Typecheck, tests, and build |

## Deploying to Vercel

1. Import the GitHub repository in Vercel. Set **Root Directory** to `web`; the framework
   preset is **Next.js** and the default build settings work.
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
   `NEXT_PUBLIC_SITE_URL` (your production origin, for example `https://<project>.vercel.app`)
   under **Settings > Environment Variables**, then redeploy. Add the beat model variables
   if you host the model ([Beat detection model](#beat-detection-model)).
3. In Supabase, under **Authentication > URL Configuration**, set the Site URL to the
   production origin and add `<origin>/auth/confirm` to the redirect URLs, so
   confirmation emails link to the deployed app rather than `localhost`.
4. Apply every file in `supabase/migrations/` to the production database before deploying
   code that depends on it (SQL Editor, or `npx supabase db push`).

Every push to the production branch redeploys. The app sets cross-origin isolation
headers on all routes (`next.config.ts`) so the analyzer can use multithreaded
WebAssembly; resources from other origins, such as a hosted model, must allow that.

## Audio analysis

Analysis runs in a Web Worker in the browser. The page decodes each file at its native sample rate, computes the asset ID (SHA-256 of the file bytes, the same ID the CLI uses), and analyzes it. Only the resulting measurements are sent to the server, and only when you choose **Save**.

| Measurement | Method | Stored as |
| --- | --- | --- |
| Frame features | Port of the CLI's `baseline.py`: 2048/512 frames, RMS, spectral centroid, bass ratio, onset flux | Summary in `track_analyses` |
| Tempo | Port of the CLI's tempogram and librosa's tempo prior; half, double, and other strong candidates | Track tempo, `estimate`, with alternatives |
| Beat grid | Beat This! `final0` through ONNX Runtime Web when the model is published, otherwise the CLI's fallback tracker; grids are fitted and accepted with the CLI's rules | Beats, downbeats (model only), segments |
| Key | STFT chroma with Krumhansl-Kessler templates; the correlation margin is a diagnostic, and weak or close results are marked `uncertain` | Track key, `estimated` or `uncertain` |
| Loudness | ITU-R BS.1770-4 integrated loudness, EBU Tech 3342 loudness range | `track_analyses`; not an energy score |
| Cue suggestions | Beat-synchronous novelty for section boundaries. Up to three entries on 8-bar phrases from the first downbeat within the first 35% of the track, and up to three exits on phrases in the last 40%, preferring section boundaries; 32 beats each (`src/lib/cues/phrases.ts`). The planner chooses among them per transition | Cue regions, `estimate`, `pending` |

Rules for saving:

- A value you reviewed (tempo or key), or a key marked not meaningful, is kept. Missing values and earlier estimates are replaced.
- Your relative energy rating is never set automatically.
- Re-analyzing a file replaces its earlier suggestions that are still pending. A suggestion is not added again when you already have a region of the same kind at nearly the same place, approved or rejected.
- Each save appends an `audio_analysis` annotation with the extractor and model identity.

The TypeScript port is checked against the CLI's Python code on synthetic signals (`tests/analysis`, fixtures from `scripts/make_analysis_fixtures.py`): frame features within 1e-4, the same tempo as librosa, identical grid fits and acceptance reasons, identical peak picking, the Beat This! log-mel front end within 2e-3, and loudness within 0.1 LU of `pyloudnorm`. These checks establish that the port reproduces the CLI. They do not measure accuracy on real music; see `docs/research/playlist-engine-evaluation.md`.

`tests/analysis/cli-drift.test.ts` keeps the port in step with the CLI. It reads `src/setvector/analysis/identity.py` and the Beat This! inference settings, and fails when an algorithm version, threshold, or front-end parameter differs from the browser copy (`src/lib/analysis/port.ts` records the CLI versions the port reproduces). When it fails, port the CLI change to `src/lib/analysis`, regenerate the fixtures with `npm run fixtures`, and update the recorded versions.

All pages are served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which lets ONNX Runtime use WASM threads. The ONNX Runtime files are copied into `public/ort` by `npm install`.

### Beat detection model

Without the model, analysis still works: the fallback tracker finds beats and tempo but no downbeats, so cue suggestions fall every 32 beats from the first beat instead of on 8-bar phrases, their labels say the bar phase is unknown, and the page says so.

The model file is about 83 MB and is not in Git. To publish it:

1. In a CLI checkout with the verified weights (`python scripts/fetch_model.py`) plus `pip install onnx onnxruntime`, export it from the repository root:

   ```bash
   PYTHONPATH=src python web/scripts/export_beat_model.py
   ```

   This writes `web/public/models/beat_this-final0.onnx` and `beat_this-final0.json`. The script checks ONNX Runtime against PyTorch on full and short chunks and refuses to write a model that differs by more than 1e-3.

2. Serve both files from the same folder:
   - **Self-hosted (`npm run start`) or local development:** keep them in `web/public/models`.
   - **Vercel:** the build does not see Git-ignored files, so host both files on any HTTPS host that sends `Access-Control-Allow-Origin` for your site. Then set `NEXT_PUBLIC_BEAT_MODEL_MANIFEST_URL` to the manifest's URL and `NEXT_PUBLIC_BEAT_MODEL_SHA256` to the `sha256` in the manifest, and redeploy.

The browser downloads the model once, checks its SHA-256 against the manifest (and the pin, if set), and caches it. Beat This! is MIT licensed; its authors note that some of its training data was copyrighted, so decide deliberately whether to host the weights publicly.

To check an export end to end through the browser pipeline:

```bash
PYTHONPATH=src python web/scripts/make_model_reference.py --out /tmp/ref.json
cd web && BEAT_MODEL_PATH=public/models/beat_this-final0.onnx BEAT_MODEL_REFERENCE=/tmp/ref.json npm run test:model
```

## Import format

JSON is an array of tracks, or `{"tracks": [...]}`. CSV needs a header row. Recognized fields:

| Field | Notes |
| --- | --- |
| `title`, `duration` | Required. Duration accepts `m:ss`, `h:mm:ss`, or seconds. |
| `artist`, `version`, `remix_group` | Text. |
| `styles` | An array in JSON, or values separated by `|` in CSV. |
| `bpm`, `bpm_alternatives`, `bpm_reviewed` | 40 to 250 BPM. |
| `key`, `key_status`, `key_reviewed` | A Camelot code (`8A`) or a key name (`A minor`, `C#m`). |
| `energy`, `energy_reviewed` | Relative 1 to 10. |
| `asset_id`, `feature_id` | IDs from `setvector analyze`. Rows whose asset ID is already in the library are skipped. |
| `cues` (JSON) | Items with `kind`, `start`, `end`, `label`, `reviewed`, and `vocal`. |
| `entry_cue`, `exit_cue`, `cues_reviewed` (CSV) | Ranges such as `0:00-0:32`. |

Values are imported as estimates unless marked reviewed.

## Energy estimates

Each analyzed track gets an experimental 1 to 10 energy estimate (`src/lib/energy/score.ts`, model `library-percentile-v1`). Five inputs are ranked against the other analyzed tracks in the same library and combined with fixed weights:

| Input | Measurement | Weight |
| --- | --- | --- |
| Loudness of the busiest sections | 90th percentile of the 3 s BS.1770 short-term loudness | 35% |
| Drum and note activity | Onsets per second of non-silent audio | 25% |
| Tempo | The track's BPM (your corrected value when you set one) | 15% |
| Bass weight | Share of spectral power below 250 Hz | 15% |
| Brightness | Mean spectral centroid | 10% |

- Each rank is a mid-rank percentile, blended with a fixed reference range weighted as eight tracks, so small libraries still get usable numbers. The score is `1 + 9 x` the weighted mean; missing inputs are left out and the weights renormalized. Loudness and two other inputs are required.
- Scores are library-relative and recomputed whenever analyses are saved, a track's tempo or energy is edited, or a track is deleted. **Library > Recalculate energy** recomputes on demand.
- `tracks.energy_model` marks values the model wrote. Only empty values and earlier model values are replaced. Any other edit to energy (the form, an import) clears the marker, so your ratings are never overwritten. Clearing the energy field hands the track back to the estimate.
- The track page lists each input's value, rank, weight, and points.
- Analyses saved before extractor version 2 lack the onset measurement; their loudness is derived from the stored short-term series. Analyze those files again for full estimates.
- The weights and reference ranges are hypotheses. They are not fitted to listener judgments, and the score is not a calibrated measure of perceived energy.

## Rekordbox import

**Library > Import > Import a Rekordbox collection** reads a file made with Rekordbox's **File > Export Collection in xml format**. The file is parsed in the browser; only the selected tracks' metadata, tempo markers, and cue points are sent, in batches of 100. Playlists are not read.

| Rekordbox | SetVector |
| --- | --- |
| `Name` (or the file name), `Artist`, `Mix` | Title, artist, version |
| `Genre` | Style tags, split on `,` `;` `/` and `|` |
| `TotalTime` | Duration. Entries without it are skipped. |
| `AverageBpm`, `Tonality` | Tempo and key, as estimates |
| `TEMPO` markers | Kept with the link and expanded into a beat grid with bar lines on the track's waveform |
| `POSITION_MARK` hot and memory cues, loops | Approved entry and exit cue regions (see below), and points on the waveform |

- Streaming entries (non-file locations) and entries without a duration cannot be imported. Entries shorter than 30 seconds or in the Rekordbox sampler folder are left unselected.
- A track is matched to the library by an earlier import of the same Rekordbox `Location`, then by a unique title and artist (and version when that separates duplicates). Otherwise a new track is created. An ambiguous title match is skipped and reported. A title match on a track linked to another location is relinked when the lengths agree within 2 seconds, since the file moved in Rekordbox; with a different length it is treated as another file. Within one import each library track takes only one entry, so duplicates in the collection become separate tracks.
- For a matched track only empty fields are filled; existing and reviewed values are kept. Importing the same file again updates the stored grid and cue points.

**Cue regions from Rekordbox** (`src/lib/rekordbox/cues.ts`):

- A cue's role comes from its type (fade-in marks are entries, fade-out marks exits), then its name (Intro, Mix in, In, Start, Entry, Begin for entries; Outro, Mix out, Out, End, Ending, Exit for exits, as whole words), then its position: the first third is an entry and the last third an exit. Unnamed cues in the middle third and load marks are skipped; the preview counts them.
- A loop keeps its own span. Any other cue starts a region of 32 beats on the Rekordbox grid (or at the average BPM without a grid), clamped to the track end; regions shorter than 2 seconds are dropped. A memory cue and a hot cue on the same point count once. At most four regions per role are kept.
- These regions are `reviewed` and `approved`, since you placed the cues yourself, and the planner prefers them.
- When a track has a grid but no usable cue for a role, the import adds up to three phrase-aligned suggestions for that role from the grid (`Grid intro at bar 1`, `Grid outro at bar 161`, ...), as `estimate` and `pending`.
- Regions created by an import keep a link to it (`cue_regions.rekordbox_link_id`). Importing again replaces only those. Editing, approving, or rejecting a region detaches it, so your decision is kept, and new regions that repeat an existing one are skipped.
- Tracks imported before this existed get their regions the next time you import the same collection.
- The XML reader is a port of `src/setvector/rekordbox/read.py` and refuses documents with a DOCTYPE or entity declarations. Grid expansion is a port of `expand_tempo` in `grid.py`. `tests/rekordbox/` checks both against fixtures generated from the Python code with `scripts/make_rekordbox_fixtures.py`.
- Rekordbox grids are a strong reference for bar lines, not ground truth. When a track also has a browser analysis, the waveform offers both grids.
- The import does not use the audio, so the asset ID stays empty until you analyze the file. On the analyze page, choose the imported track as the match so the analysis does not create a second track.

## Security

- Every table has row level security, and rows are visible only to their owner. Inserts that reference another user's tracks, crates, or plans are rejected by the policies.
- The app uses only the publishable key with the user's session. No service key is needed.
- Server actions validate all input with Zod, and route parameters are checked as UUIDs before they reach queries.

## Limitations

- Energy is your relative annotation, not a calibrated measurement. The arc term becomes meaningful only when energies are comparable across tracks.
- Cue regions are candidate mix points, not detected phrases or downbeats. Tracks without regions use labeled intro and outro windows and are flagged for review.
- Camelot relations rank candidates. They do not predict whether a blend will sound good.
- Browser analysis is a second implementation of the CLI's analysis. Parity tests cover synthetic signals; real-world accuracy on the six target styles still needs the evaluation collection.
- Without the published model there are no downbeats, and analyzer cue suggestions are not aligned to bars. Rekordbox grids carry bar positions, so grid suggestions are.
- Name matching for Rekordbox cues is English-only and literal; a cue named for its content ("Vocal", "Drop") is placed by position.
- Key detection assumes one major or minor key per region and abstains (`uncertain`) when the evidence is weak; modal or changing harmony may still be labeled wrongly.
- Vocal activity is not detected; suggested regions leave it unannotated.
- Decoding depends on the browser: MP3, AAC, WAV, FLAC, and Ogg are widely supported; ALAC and AIFF vary. A long track needs memory for its decoded samples, so analyze very long mixes on a desktop browser.
- The app plays audio only from files you open locally; it does not render mixes.
- The Rekordbox import does not write back to Rekordbox and does not read playlists. Matching by title and artist can pick the wrong track when names differ only in ways the export does not record; check the result list.
