# SetVector Web

A web app for keeping reviewed track evidence and planning DJ sets or listening playlists from it. It is built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui components, and Supabase for authentication and storage.

The web app is optional and sits beside the offline Python analyzer. It analyzes audio files in the browser, so no audio is ever uploaded: only the measurements you choose to save are stored. You can also enter or import metadata (duration, tempo, key, relative energy, cue regions). The planner runs in TypeScript on the server. The offline analysis path in `src/setvector` does not depend on the web app.

## Features

- **Library:** tracks with style tags, remix family, tempo and alternative tempos, key with a status (reviewed, estimated, uncertain, not meaningful), relative energy on a 1 to 10 scale, and analyzer asset and feature IDs. Every value records whether it is an estimate or a reviewed decision.
- **Cue regions:** entry and exit intervals `[start, end)` with review status and vocal activity. The database rejects regions that extend past the track.
- **Revisions:** track edits, cue changes, plan edits, and transition judgments are appended to an `annotations` table. Each revision points to the one it supersedes, and nothing is overwritten.
- **Audio analysis in the browser:** drop audio files on **Library > Analyze audio** to measure tempo (with half, double, and other alternatives), a beat grid, downbeats (with the model), key with a confidence margin, BS.1770 loudness, section boundaries, and entry and exit cue suggestions. Results are saved as estimates; values you reviewed are never overwritten. See [Audio analysis](#audio-analysis).
- **Waveform and cue editing:** on a track's **Audio and analysis** tab, open your local copy of the file to play it, see beat and downbeat markers, drag to create or resize cue regions snapped to beats, and approve or reject suggestions.
- **Import:** JSON or CSV with a local preview before upload (see `examples/`).
- **Crates:** saved track selections, used as fixed lists or as pools.
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
  - CSV and JSON export.

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
│   │   ├── actions/           Server actions (auth, tracks, cues, import, crates, plans)
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
│   │   ├── data/              Row mapping, queries, annotation writer
│   │   ├── supabase/          Server client, proxy helper, environment
│   │   └── validation/        Zod schemas
└── tests/                     Vitest tests: planner, keys, import, analysis parity, model
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
| `npm run fixtures` | Regenerates the analysis parity fixtures from the CLI's Python code |
| `npm run check` | Typecheck, tests, and build |

## Audio analysis

Analysis runs in a Web Worker in the browser. The page decodes each file at its native sample rate, computes the asset ID (SHA-256 of the file bytes, the same ID the CLI uses), and analyzes it. Only the resulting measurements are sent to the server, and only when you choose **Save**.

| Measurement | Method | Stored as |
| --- | --- | --- |
| Frame features | Port of the CLI's `baseline.py`: 2048/512 frames, RMS, spectral centroid, bass ratio, onset flux | Summary in `track_analyses` |
| Tempo | Port of the CLI's tempogram and librosa's tempo prior; half, double, and other strong candidates | Track tempo, `estimate`, with alternatives |
| Beat grid | Beat This! `final0` through ONNX Runtime Web when the model is published, otherwise the CLI's fallback tracker; grids are fitted and accepted with the CLI's rules | Beats, downbeats (model only), segments |
| Key | STFT chroma with Krumhansl-Kessler templates; the correlation margin is a diagnostic, and weak or close results are marked `uncertain` | Track key, `estimated` or `uncertain` |
| Loudness | ITU-R BS.1770-4 integrated loudness, EBU Tech 3342 loudness range | `track_analyses`; not an energy score |
| Cue suggestions | Beat-synchronous novelty for section boundaries; an intro region from the first downbeat and an outro region at the last boundary in the final third, 32 beats each | Cue regions, `estimate`, `pending` |

Rules for saving:

- A value you reviewed (tempo or key), or a key marked not meaningful, is kept. Missing values and earlier estimates are replaced.
- Your relative energy rating is never set automatically.
- Re-analyzing a file replaces its earlier suggestions that are still pending. A suggestion is not added again when you already have a region of the same kind at nearly the same place, approved or rejected.
- Each save appends an `audio_analysis` annotation with the extractor and model identity.

The TypeScript port is checked against the CLI's Python code on synthetic signals (`tests/analysis`, fixtures from `scripts/make_analysis_fixtures.py`): frame features within 1e-4, the same tempo as librosa, identical grid fits and acceptance reasons, identical peak picking, the Beat This! log-mel front end within 2e-3, and loudness within 0.1 LU of `pyloudnorm`. These checks establish that the port reproduces the CLI. They do not measure accuracy on real music; see `docs/research/playlist-engine-evaluation.md`.

All pages are served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which lets ONNX Runtime use WASM threads. The ONNX Runtime files are copied into `public/ort` by `npm install`.

### Beat detection model

Without the model, analysis still works: the fallback tracker finds beats and tempo but no downbeats, so cue suggestions start at the first beat instead of the first bar, and the page says so.

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

## Security

- Every table has row level security, and rows are visible only to their owner. Inserts that reference another user's tracks, crates, or plans are rejected by the policies.
- The app uses only the publishable key with the user's session. No service key is needed.
- Server actions validate all input with Zod, and route parameters are checked as UUIDs before they reach queries.

## Limitations

- Energy is your relative annotation, not a calibrated measurement. The arc term becomes meaningful only when energies are comparable across tracks.
- Cue regions are candidate mix points, not detected phrases or downbeats. Tracks without regions use labeled intro and outro windows and are flagged for review.
- Camelot relations rank candidates. They do not predict whether a blend will sound good.
- Browser analysis is a second implementation of the CLI's analysis. Parity tests cover synthetic signals; real-world accuracy on the six target styles still needs the evaluation collection.
- Without the published model there are no downbeats, and cue suggestions are not aligned to bars.
- Key detection assumes one major or minor key per region and abstains (`uncertain`) when the evidence is weak; modal or changing harmony may still be labeled wrongly.
- Vocal activity is not detected; suggested regions leave it unannotated.
- Decoding depends on the browser: MP3, AAC, WAV, FLAC, and Ogg are widely supported; ALAC and AIFF vary. A long track needs memory for its decoded samples, so analyze very long mixes on a desktop browser.
- The app plays audio only from files you open locally; it does not render mixes.
