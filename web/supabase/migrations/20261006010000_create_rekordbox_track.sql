-- Create a library track from a Rekordbox collection entry together with its link, in one
-- transaction, so a link that cannot be saved (for example, a location already linked to
-- another track) leaves no orphan track. Tempo and key are Rekordbox's own analysis, so
-- they are stored as estimates. Runs as the caller under row-level security.
--
-- p_track: {title, artist, version_label, duration_seconds, style_tags, bpm, key_tonic, key_mode}
-- p_link:  {rekordbox_track_id, location, product, tempo, marks}
-- Returns {"track_id": uuid, "link_id": uuid}.

create function public.create_rekordbox_track(p_track jsonb, p_link jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_track uuid;
  new_link uuid;
  v_bpm numeric := (p_track ->> 'bpm')::numeric;
  v_tonic smallint := (p_track ->> 'key_tonic')::smallint;
begin
  insert into public.tracks (
    title, artist, version_label, duration_seconds, style_tags,
    bpm, bpm_source, key_tonic, key_mode, key_status
  )
  values (
    p_track ->> 'title',
    coalesce(p_track ->> 'artist', ''),
    coalesce(p_track ->> 'version_label', ''),
    (p_track ->> 'duration_seconds')::numeric,
    coalesce(array(select jsonb_array_elements_text(p_track -> 'style_tags')), '{}'),
    v_bpm,
    case when v_bpm is null then null else 'estimate'::public.measurement_source end,
    v_tonic,
    case when v_tonic is null then null else (p_track ->> 'key_mode')::public.key_mode end,
    case when v_tonic is null then 'unknown'::public.key_status else 'estimated'::public.key_status end
  )
  returning id into new_track;

  insert into public.rekordbox_links (track_id, rekordbox_track_id, location, product, tempo, marks)
  values (
    new_track,
    (p_link ->> 'rekordbox_track_id')::bigint,
    p_link ->> 'location',
    coalesce(p_link -> 'product', '{}'::jsonb),
    coalesce(p_link -> 'tempo', '[]'::jsonb),
    coalesce(p_link -> 'marks', '[]'::jsonb)
  )
  returning id into new_link;

  return jsonb_build_object('track_id', new_track, 'link_id', new_link);
end;
$$;

revoke execute on function public.create_rekordbox_track(jsonb, jsonb) from public, anon;
grant execute on function public.create_rekordbox_track(jsonb, jsonb) to authenticated;
