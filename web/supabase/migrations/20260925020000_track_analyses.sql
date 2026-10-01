-- Browser audio analyses. Each row keeps one analyzer run's measurements for one audio
-- file; estimates applied to tracks and cue regions point back to it.

create table public.track_analyses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  asset_id text not null check (asset_id ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the canonical JSON of the asset ID and extractor identity.
  analysis_key text not null check (analysis_key ~ '^[0-9a-f]{64}$'),
  extractor jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, analysis_key)
);

create index track_analyses_track_idx on public.track_analyses (track_id, created_at desc);

alter table public.cue_regions
  add column analysis_id uuid references public.track_analyses (id) on delete set null;

create index cue_regions_analysis_idx on public.cue_regions (analysis_id) where analysis_id is not null;

alter table public.track_analyses enable row level security;

create policy "track analyses are private" on public.track_analyses
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid()))
  );
