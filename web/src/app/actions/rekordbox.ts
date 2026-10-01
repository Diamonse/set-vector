"use server";

import { revalidatePath } from "next/cache";
import { recordAnnotation } from "@/lib/data/annotations";
import { mapRekordboxCues } from "@/lib/rekordbox/cues";
import { rekordboxImportSchema, type RekordboxImportTrack } from "@/lib/rekordbox/schema";
import type { ServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/server";

export interface RekordboxOutcome {
  rekordboxTrackId: number;
  status: "created" | "linked" | "updated" | "skipped";
  trackId: string | null;
  message: string;
  /** Cue regions created from this entry's Rekordbox cues and grid. */
  cueRegions?: number;
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

async function loadLinks(supabase: ServerClient): Promise<{ track_id: string; location: string }[]> {
  const rows: { track_id: string; location: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("rekordbox_links").select("track_id, location").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { track_id: string; location: string }[]));
    if (!data || data.length < PAGE) return rows;
  }
}

interface CueWork {
  linkId: string;
  trackId: string;
  duration: number;
  track: RekordboxImportTrack;
  outcome: number;
}

/**
 * Replace the cue regions earlier imports created for these links with regions from the
 * current cues and grid. Regions the user edited or reviewed were detached by a trigger and
 * stay; new regions that repeat any existing region are skipped.
 */
async function applyCueRegions(supabase: ServerClient, work: CueWork[], outcomes: RekordboxOutcome[]): Promise<string | null> {
  if (!work.length) return null;
  const { error: deleteError } = await supabase.from("cue_regions").delete().in("rekordbox_link_id", work.map((w) => w.linkId));
  if (deleteError) return `Earlier Rekordbox cue regions could not be replaced: ${deleteError.message}`;
  const { data: existingRows, error: readError } = await supabase
    .from("cue_regions")
    .select("track_id, kind, start_seconds, end_seconds")
    .in("track_id", [...new Set(work.map((w) => w.trackId))]);
  if (readError) return `Cue regions could not be read: ${readError.message}`;
  const existing = (existingRows ?? []) as { track_id: string; kind: string; start_seconds: number | string; end_seconds: number | string }[];

  const rows: Record<string, unknown>[] = [];
  for (const w of work) {
    const { regions } = mapRekordboxCues(w.track.marks, w.track.tempo, w.duration, w.track.bpm);
    const fresh = regions.filter(
      (r) =>
        !existing.some(
          (e) =>
            e.track_id === w.trackId &&
            e.kind === r.kind &&
            Math.abs(Number(e.start_seconds) - r.startSeconds) < 0.5 &&
            Math.abs(Number(e.end_seconds) - r.endSeconds) < 0.5,
        ),
    );
    for (const r of fresh) {
      const approved = r.origin === "rekordbox_cue";
      rows.push({
        track_id: w.trackId,
        kind: r.kind,
        start_seconds: r.startSeconds,
        end_seconds: r.endSeconds,
        label: r.label.slice(0, 120),
        provenance: approved ? "reviewed" : "estimate",
        review_status: approved ? "approved" : "pending",
        vocal_activity: "unknown",
        rekordbox_link_id: w.linkId,
      });
    }
    outcomes[w.outcome]!.cueRegions = fresh.length;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("cue_regions").insert(rows.slice(i, i + 500));
    if (error) return `Cue regions could not be saved: ${error.message}`;
  }
  return null;
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
  // Read every link once and match in memory: a filter listing the batch's locations
  // makes the request URL too long for real file paths.
  let links: { track_id: string; location: string }[];
  try {
    links = await loadLinks(supabase);
  } catch (error) {
    return { ok: false, message: `Rekordbox links could not be read: ${(error as Error).message}`, outcomes: [] };
  }
  const linkedByLocation = new Map(links.map((l) => [l.location, l.track_id]));
  const linkedTracks = new Set(links.map((l) => l.track_id));
  // A library track takes at most one entry per import run, so duplicates in the collection stay separate.
  const claimed = new Set(claimedTrackIds);

  const outcomes: RekordboxOutcome[] = [];
  const cueWork: CueWork[] = [];
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

    const { data: link, error } = await supabase.from("rekordbox_links").upsert(
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
    ).select("id").single();
    if (error || !link) {
      const message = !error ? "no link returned" : error.message.includes("location") ? "Another library track is already linked to this Rekordbox file." : error.message;
      outcomes.push({ rekordboxTrackId: t.rekordboxTrackId, status: "skipped", trackId: row.id, message: `Grid and cues not saved: ${message}` });
      continue;
    }
    claimed.add(row.id);
    linkedTracks.add(row.id);
    cueWork.push({ linkId: (link as { id: string }).id, trackId: row.id, duration: Number(row.duration_seconds), track: t, outcome: outcomes.length });
    outcomes.push({
      rekordboxTrackId: t.rekordboxTrackId,
      status,
      trackId: row.id,
      message: status === "created" ? "Added to the library." : status === "linked" ? "Linked to an existing track." : "Updated the existing link.",
    });
  }

  const cueError = await applyCueRegions(supabase, cueWork, outcomes);
  if (cueError) return { ok: false, message: cueError, outcomes };

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
