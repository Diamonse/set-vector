-- Automatic energy estimates. tracks.energy_model names the model that wrote the current
-- energy value; it is null for values the user entered or imported. Only model-written or
-- empty values are ever replaced by a new estimate.

alter table public.tracks
  add column energy_model text check (energy_model is null or char_length(energy_model) <= 64);

alter table public.tracks
  add constraint tracks_energy_model check (energy_model is null or (energy is not null and energy_source = 'estimate'));

-- Any other change to energy or its source (a form edit, an import) hands the value back
-- to the user by clearing energy_model. apply_energy_estimates sets a transaction-local
-- flag so its own writes keep the marker.
create function public.clear_energy_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('setvector.energy_model_write', true), '') = 'on' then
    return new;
  end if;
  if new.energy is distinct from old.energy or new.energy_source is distinct from old.energy_source then
    new.energy_model := null;
  end if;
  return new;
end;
$$;

create trigger tracks_clear_energy_model
  before update of energy, energy_source on public.tracks
  for each row execute function public.clear_energy_model();

revoke execute on function public.clear_energy_model() from public, anon, authenticated;

-- Apply a batch of estimates for the calling user's tracks. Each item is
-- {"id": uuid, "energy": number | null}; null removes an earlier model estimate.
-- Tracks whose energy the user set are skipped. Returns the number of tracks changed.
create function public.apply_energy_estimates(estimates jsonb, model text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if jsonb_typeof(estimates) <> 'array' then
    raise exception 'estimates must be a JSON array';
  end if;
  perform set_config('setvector.energy_model_write', 'on', true);
  with input as (
    select (e ->> 'id')::uuid as id, (e ->> 'energy')::numeric(4, 2) as energy
    from jsonb_array_elements(estimates) as e
  )
  update public.tracks as t
  set energy = i.energy,
      energy_source = case when i.energy is null then null else 'estimate'::public.measurement_source end,
      energy_model = case when i.energy is null then null else model end
  from input as i
  where t.id = i.id
    and t.owner_id = (select auth.uid())
    and (t.energy is null or t.energy_model is not null)
    and (t.energy is distinct from i.energy or t.energy_model is distinct from case when i.energy is null then null else model end);
  get diagnostics changed = row_count;
  perform set_config('setvector.energy_model_write', 'off', true);
  return changed;
end;
$$;

revoke execute on function public.apply_energy_estimates(jsonb, text) from public, anon;
grant execute on function public.apply_energy_estimates(jsonb, text) to authenticated;
