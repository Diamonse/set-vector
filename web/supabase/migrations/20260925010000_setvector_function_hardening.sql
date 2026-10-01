-- Pin search_path on trigger helpers and keep the signup trigger function out of the public RPC API.
alter function public.touch_updated_at() set search_path = '';
alter function public.check_cue_bounds() set search_path = '';
alter function public.check_track_duration_covers_cues() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
