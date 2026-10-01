-- Cue regions created from a Rekordbox import point back to the import's link. Importing
-- the same file again replaces only regions that still carry the link. Editing, approving,
-- or rejecting a region detaches it, so the user's decision survives later imports.

alter table public.cue_regions
  add column rekordbox_link_id uuid references public.rekordbox_links (id) on delete set null;

create index cue_regions_rekordbox_link_idx on public.cue_regions (rekordbox_link_id) where rekordbox_link_id is not null;

create function public.detach_edited_rekordbox_cue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rekordbox_link_id is not null and new.rekordbox_link_id is not distinct from old.rekordbox_link_id then
    new.rekordbox_link_id := null;
  end if;
  return new;
end;
$$;

create trigger cue_regions_detach_rekordbox
  before update of kind, start_seconds, end_seconds, label, provenance, review_status, vocal_activity on public.cue_regions
  for each row execute function public.detach_edited_rekordbox_cue();

revoke execute on function public.detach_edited_rekordbox_cue() from public, anon, authenticated;
