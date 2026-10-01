-- Links between library tracks and Rekordbox collection entries. Each row keeps the
-- Rekordbox tempo markers (the grid to review against) and cue points as exported.

create table public.rekordbox_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  rekordbox_track_id bigint not null check (rekordbox_track_id > 0),
  -- The Rekordbox Location URI; the match key for later imports.
  location text not null check (char_length(location) between 1 and 4000),
  product jsonb not null default '{}'::jsonb check (jsonb_typeof(product) = 'object'),
  tempo jsonb not null default '[]'::jsonb check (jsonb_typeof(tempo) = 'array'),
  marks jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array'),
  imported_at timestamptz not null default now(),
  unique (owner_id, track_id),
  unique (owner_id, location)
);

create index rekordbox_links_track_idx on public.rekordbox_links (track_id);

alter table public.rekordbox_links enable row level security;

create policy "rekordbox links are private" on public.rekordbox_links
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid()))
  );
