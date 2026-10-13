-- Create a plan and its items in one transaction, so a failure cannot leave a plan
-- without items. Each item has the shape replace_plan_items takes. Runs as the caller,
-- so row-level security checks the plan, its crate, and every item's track.

create function public.create_plan(
  p_name text,
  p_mode public.plan_mode,
  p_selection_policy public.selection_policy,
  p_crate_id uuid,
  p_request jsonb,
  p_result jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;

  insert into public.plans (name, mode, selection_policy, crate_id, request, result)
  values (p_name, p_mode, p_selection_policy, p_crate_id, p_request, p_result)
  returning id into new_id;

  insert into public.plan_items (
    plan_id, position, occurrence_id, track_id, entry_cue_id, exit_cue_id,
    play_start_seconds, play_end_seconds, elapsed_start_seconds
  )
  select
    new_id,
    (item ->> 'position')::integer,
    item ->> 'occurrence_id',
    (item ->> 'track_id')::uuid,
    item ->> 'entry_cue_id',
    item ->> 'exit_cue_id',
    (item ->> 'play_start_seconds')::numeric,
    (item ->> 'play_end_seconds')::numeric,
    (item ->> 'elapsed_start_seconds')::numeric
  from jsonb_array_elements(p_items) as item;

  return new_id;
end;
$$;

revoke execute on function public.create_plan(text, public.plan_mode, public.selection_policy, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_plan(text, public.plan_mode, public.selection_policy, uuid, jsonb, jsonb, jsonb) to authenticated;
