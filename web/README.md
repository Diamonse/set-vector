# SetVector Web

A web app for keeping reviewed track evidence and planning DJ sets or listening playlists from it. It is built with Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui components, and Supabase for authentication and storage.

The web app is optional and sits beside the offline Python analyzer. It never receives audio. You enter or import metadata (duration, tempo, key, relative energy, cue regions), and the planner runs in TypeScript on the server. The offline analysis path in `src/setvector` does not depend on it.

## Features

- **Library:** tracks with style tags, remix family, tempo and alternative tempos, key with a status (reviewed, estimated, uncertain, not meaningful), relative energy on a 1 to 10 scale, and analyzer asset and feature IDs. Every value records whether it is an estimate or a reviewed decision.
- **Cue regions:** entry and exit intervals `[start, end)` with review status and vocal activity. The database rejects regions that extend past the track.
- **Revisions:** track edits, cue changes, plan edits, and transition judgments are appended to an `annotations` table. Each revision points to the one it supersedes, and nothing is overwritten.
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
│   │   ├── library/ crates/ plans/
│   ├── lib/
│   │   ├── domain/            Types, Camelot and key parsing, formatting
│   │   ├── planner/           Planning engine (pure TypeScript)
│   │   ├── import/            JSON and CSV import parser
│   │   ├── data/              Row mapping, queries, annotation writer
│   │   ├── supabase/          Server client, proxy helper, environment
│   │   └── validation/        Zod schemas
└── tests/                     Vitest tests for the planner, keys, and import
```

## Local setup

Requirements: Node.js 20.9 or newer and a Supabase project.

1. Install dependencies:

   ```bash
   cd web
   npm install
   ```

2. Create the database schema. In the Supabase dashboard, open **SQL Editor**, then paste and run `supabase/migrations/20260925000000_setvector_init.sql`. Alternatively, with the Supabase CLI linked to your project, run:

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
| `npm test` | Vitest unit tests |
| `npm run check` | Typecheck, tests, and build |

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
- The app does not render or play audio.
