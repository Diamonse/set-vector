-- SetVector web: library, reviewed annotations, crates, and saved plans.
-- Every row is owned by one user and protected by row level security.

create extension if not exists pgcrypto;

-- Enumerations -------------------------------------------------------------

create type public.measurement_source as enum ('estimate', 'reviewed');
create type public.key_status as enum ('unknown', 'estimated', 'reviewed', 'uncertain', 'not_meaningful');
create type public.key_mode as enum ('major', 'minor');
create type public.cue_kind as enum ('entry', 'exit');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.vocal_activity as enum ('unknown', 'none', 'present');
create type public.annotation_level as enum ('track', 'region', 'pair', 'sequence');
create type public.plan_mode as enum ('dj', 'listening');
create type public.selection_policy as enum ('use_all', 'choose_from_pool');

-- Shared trigger helpers ---------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Profiles -----------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tracks -------------------------------------------------------------------
-- Mutable library records. Asset and feature IDs refer to artifacts produced by
-- the offline Python analyzer; they are references, never rewritten here.

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  artist text not null default '' check (char_length(artist) <= 300),
  version_label text not null default '' check (char_length(version_label) <= 200),
  remix_group text not null default '' check (char_length(remix_group) <= 200),
  duration_seconds numeric(10, 3) not null check (duration_seconds > 0 and duration_seconds < 86400),
  style_tags text[] not null default '{}',
  bpm numeric(7, 3) check (bpm is null or (bpm >= 40 and bpm <= 250)),
  bpm_alternatives numeric(7, 3)[] not null default '{}',
  bpm_source public.measurement_source,
  key_tonic smallint check (key_tonic is null or (key_tonic between 0 and 11)),
  key_mode public.key_mode,
  key_status public.key_status not null default 'unknown',
  energy numeric(4, 2) check (energy is null or (energy >= 1 and energy <= 10)),
  energy_source public.measurement_source,
  asset_id text check (asset_id is null or char_length(asset_id) <= 128),
  feature_id text check (feature_id is null or char_length(feature_id) <= 128),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracks_key_pair check ((key_tonic is null) = (key_mode is null)),
  constraint tracks_bpm_source check ((bpm is null) = (bpm_source is null)),
  constraint tracks_energy_source check ((energy is null) = (energy_source is null))
);

create unique index tracks_owner_asset_idx on public.tracks (owner_id, asset_id) where asset_id is not null;
create index tracks_owner_idx on public.tracks (owner_id, artist, title);
create index tracks_style_idx on public.tracks using gin (style_tags);

create trigger tracks_touch before update on public.tracks
  for each row execute function public.touch_updated_at();

-- Cue regions --------------------------------------------------------------
-- Half-open source intervals [start, end) that may serve as mix entry or exit.

create table public.cue_regions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  kind public.cue_kind not null,
  start_seconds numeric(10, 3) not null check (start_seconds >= 0),
  end_seconds numeric(10, 3) not null,
  label text not null default '' check (char_length(label) <= 120),
  provenance public.measurement_source not null default 'reviewed',
  review_status public.review_status not null default 'approved',
  vocal_activity public.vocal_activity not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cue_regions_order check (end_seconds > start_seconds)
);

create index cue_regions_track_idx on public.cue_regions (track_id, kind, start_seconds);

create trigger cue_regions_touch before update on public.cue_regions
  for each row execute function public.touch_updated_at();

create or replace function public.check_cue_bounds()
returns trigger
language plpgsql
as $$
declare
  track_duration numeric;
  track_owner uuid;
begin
  select duration_seconds, owner_id into track_duration, track_owner
  from public.tracks where id = new.track_id;
  if track_duration is null then
    raise exception 'track % not found', new.track_id;
  end if;
  if track_owner <> new.owner_id then
    raise exception 'cue owner must match track owner';
  end if;
  if new.end_seconds > track_duration then
    raise exception 'cue region ends at % s, beyond track duration % s', new.end_seconds, track_duration;
  end if;
  return new;
end;
$$;

create trigger cue_regions_bounds before insert or update on public.cue_regions
  for each row execute function public.check_cue_bounds();

create or replace function public.check_track_duration_covers_cues()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.cue_regions
    where track_id = new.id and end_seconds > new.duration_seconds
  ) then
    raise exception 'duration % s would leave existing cue regions outside the track', new.duration_seconds;
  end if;
  return new;
end;
$$;

create trigger tracks_duration_covers_cues before update of duration_seconds on public.tracks
  for each row execute function public.check_track_duration_covers_cues();

-- Annotations --------------------------------------------------------------
-- Append-only record of estimates and human decisions. A revision names the
-- annotation it supersedes; nothing is overwritten.

create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  level public.annotation_level not null,
  task text not null check (char_length(task) between 1 and 80),
  track_id uuid references public.tracks (id) on delete cascade,
  to_track_id uuid references public.tracks (id) on delete cascade,
  plan_id uuid,
  region_start_seconds numeric(10, 3),
  region_end_seconds numeric(10, 3),
  is_estimate boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  note text not null default '' check (char_length(note) <= 2000),
  revision integer not null default 1 check (revision >= 1),
  supersedes_id uuid references public.annotations (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint annotations_region_order check (
    region_start_seconds is null or region_end_seconds is null or region_end_seconds > region_start_seconds
  ),
  constraint annotations_pair_target check (level <> 'pair' or (track_id is not null and to_track_id is not null))
);

create index annotations_track_idx on public.annotations (track_id, created_at desc);
create index annotations_owner_idx on public.annotations (owner_id, created_at desc);

-- Crates -------------------------------------------------------------------

create table public.crates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger crates_touch before update on public.crates
  for each row execute function public.touch_updated_at();

create table public.crate_tracks (
  crate_id uuid not null references public.crates (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position integer not null default 0,
  added_at timestamptz not null default now(),
  primary key (crate_id, track_id)
);

create index crate_tracks_track_idx on public.crate_tracks (track_id);

-- Plans --------------------------------------------------------------------
-- A plan stores its full request, the evaluated proposal, alternatives, and
-- baseline comparisons. plan_items holds the editable ordered occurrences.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  mode public.plan_mode not null,
  selection_policy public.selection_policy not null,
  crate_id uuid references public.crates (id) on delete set null,
  request jsonb not null,
  result jsonb not null,
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plans_owner_idx on public.plans (owner_id, created_at desc);

create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

alter table public.annotations
  add constraint annotations_plan_fk foreign key (plan_id) references public.plans (id) on delete cascade;

create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete cascade,
  position integer not null check (position >= 0),
  occurrence_id text not null,
  track_id uuid not null references public.tracks (id) on delete cascade,
  entry_cue_id text,
  exit_cue_id text,
  play_start_seconds numeric(10, 3) not null,
  play_end_seconds numeric(10, 3) not null,
  elapsed_start_seconds numeric(10, 3) not null,
  unique (plan_id, position),
  unique (plan_id, occurrence_id)
);

create index plan_items_plan_idx on public.plan_items (plan_id, position);

-- Row level security -------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.cue_regions enable row level security;
alter table public.annotations enable row level security;
alter table public.crates enable row level security;
alter table public.crate_tracks enable row level security;
alter table public.plans enable row level security;
alter table public.plan_items enable row level security;

create policy "profiles are private" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "tracks are private" on public.tracks
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "cue regions are private" on public.cue_regions
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid()))
  );

create policy "annotations are readable by owner" on public.annotations
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "annotations are appended by owner" on public.annotations
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (track_id is null or exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid())))
    and (to_track_id is null or exists (select 1 from public.tracks t where t.id = to_track_id and t.owner_id = (select auth.uid())))
  );

create policy "crates are private" on public.crates
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "crate tracks are private" on public.crate_tracks
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.crates c where c.id = crate_id and c.owner_id = (select auth.uid()))
    and exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid()))
  );

create policy "plans are private" on public.plans
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (crate_id is null or exists (select 1 from public.crates c where c.id = crate_id and c.owner_id = (select auth.uid())))
  );

create policy "plan items are private" on public.plan_items
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.plans p where p.id = plan_id and p.owner_id = (select auth.uid()))
    and exists (select 1 from public.tracks t where t.id = track_id and t.owner_id = (select auth.uid()))
  );

-- Replace a plan's items atomically after an edit. Runs as the caller, so RLS
-- still applies to every statement.
create or replace function public.replace_plan_items(p_plan_id uuid, p_items jsonb, p_result jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.plans where id = p_plan_id and owner_id = (select auth.uid())) then
    raise exception 'plan not found';
  end if;

  delete from public.plan_items where plan_id = p_plan_id;

  insert into public.plan_items (
    plan_id, position, occurrence_id, track_id, entry_cue_id, exit_cue_id,
    play_start_seconds, play_end_seconds, elapsed_start_seconds
  )
  select
    p_plan_id,
    (item ->> 'position')::integer,
    item ->> 'occurrence_id',
    (item ->> 'track_id')::uuid,
    item ->> 'entry_cue_id',
    item ->> 'exit_cue_id',
    (item ->> 'play_start_seconds')::numeric,
    (item ->> 'play_end_seconds')::numeric,
    (item ->> 'elapsed_start_seconds')::numeric
  from jsonb_array_elements(p_items) as item;

  update public.plans set result = p_result, edited = true where id = p_plan_id;
end;
$$;

grant execute on function public.replace_plan_items(uuid, jsonb, jsonb) to authenticated;
