"use server";

import { revalidatePath } from "next/cache";
import { recordAnnotation } from "@/lib/data/annotations";
import { rekordboxImportSchema, type RekordboxImportTrack } from "@/lib/rekordbox/schema";
import type { ServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/server";

export interface RekordboxOutcome {
  rekordboxTrackId: number;
  status: "created" | "linked" | "updated" | "skipped";
  trackId: string | null;
  message: string;
}

export interface RekordboxBatchResult {
  ok: boolean;
  message: string;
  outcomes: RekordboxOutcome[];
}

interface LibraryRow {
  id: string;
  title: string;
  artist: string;
  version_label: string;
  duration_seconds: number | string;
  style_tags: string[];
  bpm: number | string | null;
  key_status: string;
}

const LIBRARY_FIELDS = "id, title, artist, version_label, duration_seconds, style_tags, bpm, key_status";
const PAGE = 1000;
/** Rekordbox `TotalTime` is whole seconds; a decoded or typed duration may differ slightly. */
const DURATION_TOLERANCE_SECONDS = 2;

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

async function loadLibrary(supabase: ServerClient): Promise<LibraryRow[]> {
  const rows: LibraryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("tracks").select(LIBRARY_FIELDS).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as LibraryRow[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Fill only what the library track lacks; reviewed and existing values are never replaced. */
function fillEmpty(row: LibraryRow, t: RekordboxImportTrack): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (row.bpm === null && t.bpm !== null) Object.assign(patch, { bpm: t.bpm, bpm_source: "estimate" });
  if (row.key_status === "unknown" && t.key) Object.assign(patch, { key_tonic: t.key.tonic, key_mode: t.key.mode, key_status: "estimated" });
  if (row.style_tags.length === 0 && t.styleTags.length) patch.style_tags = t.styleTags;
  if (!row.version_label && t.versionLabel) patch.version_label = t.versionLabel;
  return patch;
}

/**
 * Import one batch of Rekordbox tracks parsed in the browser. A track is matched by an
 * earlier link to the same Rekordbox location, then by a unique title and artist (and
 * version when that separates duplicates) among tracks this import has not matched yet;
 * otherwise a new track is created. Tempo and key
 * are estimates. The Rekordbox grid and cue points are kept on the link for review.
 */
export async function importRekordboxBatch(input: unknown): Promise<RekordboxBatchResult> {
  const parsed = rekordboxImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: `The batch was not valid: ${parsed.error.issues[0]?.message ?? "unknown error"}`, outcomes: [] };
  const { product, tracks, claimedTrackIds } = parsed.data;
  const { supabase } = await requireUser();

  let library: LibraryRow[];
  try {
    library = await loadLibrary(supabase);
  } catch (error) {
    return { ok: false, message: `The library could not be read: ${(error as Error).message}`, outcomes: [] };
  }
  const byId = new Map(library.map((r) => [r.id, r]));
  const { data: linkRows, error: linkError } = await supabase
    .from("rekordbox_links")
    .select("track_id, location")
    .in("location", tracks.map((t) => t.location));
  if (linkError) return { ok: false, message: `Rekordbox links could not be read: ${linkError.message}`, outcomes: [] };
  const linkedByLocation = new Map((linkRows ?? []).map((l) => [l.location as string, l.track_id as string]));
  const { data: allLinks, error: allLinksError } = await supabase.from("rekordbox_links").select("track_id");
  if (allLinksError) return { ok: false, message: `Rekordbox links could not be read: ${allLinksError.message}`, outcomes: [] };
  const linkedTracks = new Set((allLinks ?? []).map((l) => l.track_id as string));
  // A library track takes at most one entry per import run, so duplicates in the collection stay separate.
  const claimed = new Set(claimedTrackIds);

  const outcomes: RekordboxOutcome[] = [];
  for (const t of tracks) {
    const skip = (message: string) => outcomes.push({ rekordboxTrackId: t.rekordboxTrackId, status: "skipped", trackId: null, message });
    let row: LibraryRow | undefined;
    let status: RekordboxOutcome["status"];
    const linked = linkedByLocation.get(t.location);
    if (linked && claimed.has(linked)) {
      skip("Another entry in this import already uses this library track.");
      continue;
    }
    if (linked && byId.has(linked)) {
      row = byId.get(linked);
      status = "updated";
    } else {
      const close = (r: LibraryRow) => Math.abs(Number(r.duration_seconds) - t.durationSeconds) <= DURATION_TOLERANCE_SECONDS;
      // A track linked to another location is relinked only when its length agrees: the file
      // moved in Rekordbox. A different length is another file with the same name.
      let matches = library.filter(
        (r) => !claimed.has(r.id) && norm(r.title) === norm(t.title) && norm(r.artist) === norm(t.artist) && (!linkedTracks.has(r.id) || close(r)),
      );
      if (matches.length > 1) matches = matches.filter((r) => norm(r.version_label) === norm(t.versionLabel));
      if (matches.length > 1 && matches.some(close)) matches = matches.filter(close);
      if (matches.length > 1) {
        skip(`Matches ${matches.length} library tracks with the same title and artist; not linked.`);
        continue;
      }
      row = matches[0];
      status = row ? "linked" : "created";
    }

    if (!row) {
      const { data, error } = await supabase
        .from("tracks")
        .insert({
          title: t.title,
          artist: t.artist,
          version_label: t.versionLabel,
          duration_seconds: t.durationSeconds,
          style_tags: t.styleTags,
          bpm: t.bpm,
          bpm_source: t.bpm === null ? null : "estimate",
          key_tonic: t.key?.tonic ?? null,
          key_mode: t.key?.mode ?? null,
          key_status: t.key ? "estimated" : "unknown",
        })
        .select(LIBRARY_FIELDS)
        .single();
      if (error || !data) {
        skip(`The track was not created: ${error?.message ?? "no row returned"}`);
        continue;
      }
      row = data as LibraryRow;
      library.push(row);
      byId.set(row.id, row);
    } else {
      const patch = fillEmpty(row, t);
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("tracks").update(patch).eq("id", row.id);
        if (error) {
          skip(`The library track was not updated: ${error.message}`);
          continue;
        }
      }
    }

    const { error } = await supabase.from("rekordbox_links").upsert(
      {
        track_id: row.id,
        rekordbox_track_id: t.rekordboxTrackId,
        location: t.location,
        product,
        tempo: t.tempo,
        marks: t.marks,
        imported_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,track_id" },
    );
    if (error) {
      const message = error.message.includes("location") ? "Another library track is already linked to this Rekordbox file." : error.message;
      outcomes.push({ rekordboxTrackId: t.rekordboxTrackId, status: "skipped", trackId: row.id, message: `Grid and cues not saved: ${message}` });
      continue;
    }
    claimed.add(row.id);
    linkedTracks.add(row.id);
    outcomes.push({
      rekordboxTrackId: t.rekordboxTrackId,
      status,
      trackId: row.id,
      message: status === "created" ? "Added to the library." : status === "linked" ? "Linked to an existing track." : "Updated the existing link.",
    });
  }

  const counts = { created: 0, linked: 0, updated: 0, skipped: 0 };
  outcomes.forEach((o) => counts[o.status]++);
  if (counts.created + counts.linked + counts.updated > 0) {
    await recordAnnotation(supabase, {
      level: "track",
      task: "rekordbox_import",
      isEstimate: true,
      payload: { product, ...counts },
    });
  }
  revalidatePath("/library");
  return { ok: counts.skipped < outcomes.length, message: "", outcomes };
}
