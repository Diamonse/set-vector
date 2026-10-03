import "server-only";
import type { Annotation, Crate, Track } from "@/lib/domain/types";
import type { PlanRequest, PlanResult } from "@/lib/planner";
import type { PlaylistEntry } from "@/lib/rekordbox/playlist";
import type { ServerClient } from "@/lib/supabase/server";
import { toAnnotation, toCrate, toTrack, type AnnotationRow, type CrateRow, type TrackRow } from "./rows";

const TRACK_SELECT = "*, cue_regions(*)";
const PAGE = 1000;
const ID_BATCH = 150;

/** Loads the whole library with cues, paging past PostgREST's row limit. */
export async function listTracks(supabase: ServerClient): Promise<Track[]> {
  const tracks: Track[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("tracks")
      .select(TRACK_SELECT)
      .order("artist", { ascending: true })
      .order("title", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not load the library: ${error.message}`);
    const rows = (data ?? []) as TrackRow[];
    tracks.push(...rows.map(toTrack));
    if (rows.length < PAGE) break;
  }
  return tracks;
}

export async function getTrack(supabase: ServerClient, id: string): Promise<Track | null> {
  const { data, error } = await supabase.from("tracks").select(TRACK_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the track: ${error.message}`);
  return data ? toTrack(data as TrackRow) : null;
}

export async function listTrackAnnotations(supabase: ServerClient, trackId: string): Promise<Annotation[]> {
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .or(`track_id.eq.${trackId},to_track_id.eq.${trackId}`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load annotations: ${error.message}`);
  return ((data ?? []) as AnnotationRow[]).map(toAnnotation);
}

export async function listPlanAnnotations(supabase: ServerClient, planId: string): Promise<Annotation[]> {
  const { data, error } = await supabase
    .from("annotations")
    .select("*")
    .eq("plan_id", planId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load plan annotations: ${error.message}`);
  return ((data ?? []) as AnnotationRow[]).map(toAnnotation);
}

export async function listCrates(supabase: ServerClient): Promise<Crate[]> {
  const { data, error } = await supabase
    .from("crates")
    .select("*, crate_tracks(track_id, position)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load crates: ${error.message}`);
  return ((data ?? []) as CrateRow[]).map(toCrate);
}

export async function getCrate(supabase: ServerClient, id: string): Promise<Crate | null> {
  const { data, error } = await supabase
    .from("crates")
    .select("*, crate_tracks(track_id, position)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the crate: ${error.message}`);
  return data ? toCrate(data as CrateRow) : null;
}

export interface PlanSummary {
  id: string;
  name: string;
  mode: PlanRequest["mode"];
  selectionPolicy: PlanRequest["selectionPolicy"];
  edited: boolean;
  createdAt: string;
  trackCount: number;
  totalSeconds: number;
  violationCount: number;
}

export interface StoredPlan extends Omit<PlanSummary, "trackCount" | "totalSeconds" | "violationCount"> {
  crateId: string | null;
  request: PlanRequest;
  result: PlanResult;
  updatedAt: string;
}

interface PlanRow {
  id: string;
  name: string;
  mode: PlanRequest["mode"];
  selection_policy: PlanRequest["selectionPolicy"];
  crate_id: string | null;
  request: PlanRequest;
  result: PlanResult;
  edited: boolean;
  created_at: string;
  updated_at: string;
}

export async function listPlans(supabase: ServerClient): Promise<PlanSummary[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, mode, selection_policy, edited, created_at, result->proposal->metrics, result->proposal->violations")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      mode: PlanRequest["mode"];
      selection_policy: PlanRequest["selectionPolicy"];
      edited: boolean;
      created_at: string;
      metrics: PlanResult["proposal"]["metrics"] | null;
      violations: unknown[] | null;
    }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    selectionPolicy: r.selection_policy,
    edited: r.edited,
    createdAt: r.created_at,
    trackCount: r.metrics?.trackCount ?? 0,
    totalSeconds: r.metrics?.totalSeconds ?? 0,
    violationCount: r.violations?.length ?? 0,
  }));
}

export async function getPlan(supabase: ServerClient, id: string): Promise<StoredPlan | null> {
  const { data, error } = await supabase.from("plans").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the plan: ${error.message}`);
  if (!data) return null;
  const row = data as PlanRow;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    selectionPolicy: row.selection_policy,
    crateId: row.crate_id,
    request: row.request,
    result: row.result,
    edited: row.edited,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface StoredAnalysis {
  id: string;
  createdAt: string;
  result: import("@/lib/analysis/types").AnalysisResult;
}

/** Latest browser analysis of a track, or null. Returns null if the table is not migrated yet. */
export async function getLatestAnalysis(supabase: ServerClient, trackId: string): Promise<StoredAnalysis | null> {
  const { data, error } = await supabase
    .from("track_analyses")
    .select("id, created_at, result")
    .eq("track_id", trackId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; created_at: string; result: StoredAnalysis["result"] };
  return { id: row.id, createdAt: row.created_at, result: row.result };
}

export interface StoredRekordboxLink {
  rekordboxTrackId: number;
  location: string;
  tempo: import("@/lib/rekordbox/read").TempoMarker[];
  marks: import("@/lib/rekordbox/read").PositionMark[];
  importedAt: string;
}

/** The Rekordbox entry linked to a track, or null. Returns null if the table is not migrated yet. */
export async function getRekordboxLink(supabase: ServerClient, trackId: string): Promise<StoredRekordboxLink | null> {
  const { data, error } = await supabase
    .from("rekordbox_links")
    .select("rekordbox_track_id, location, tempo, marks, imported_at")
    .eq("track_id", trackId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { rekordbox_track_id: number; location: string; tempo: StoredRekordboxLink["tempo"]; marks: StoredRekordboxLink["marks"]; imported_at: string };
  return { rekordboxTrackId: Number(row.rekordbox_track_id), location: row.location, tempo: row.tempo, marks: row.marks, importedAt: row.imported_at };
}

/** Rekordbox Location URIs keyed by track id; tracks without a link are absent. Empty if the table is not migrated yet. */
async function listRekordboxLocations(supabase: ServerClient, ids: string[]): Promise<Map<string, string>> {
  const locations = new Map<string, string>();
  // Batches keep the id filter well inside URL length limits.
  for (let from = 0; from < ids.length; from += ID_BATCH) {
    const { data, error } = await supabase
      .from("rekordbox_links")
      .select("track_id, location")
      .in("track_id", ids.slice(from, from + ID_BATCH));
    if (error) return locations;
    for (const row of (data ?? []) as { track_id: string; location: string }[]) locations.set(row.track_id, row.location);
  }
  return locations;
}

/** Playlist entries for plan items in set order, with each track's duration and Rekordbox location. */
export async function listPlaylistEntries(
  supabase: ServerClient,
  items: { trackId: string; title: string; artist: string }[],
): Promise<PlaylistEntry[]> {
  const ids = [...new Set(items.map((i) => i.trackId))];
  const durations = new Map<string, number>();
  for (let from = 0; from < ids.length; from += ID_BATCH) {
    const { data, error } = await supabase
      .from("tracks")
      .select("id, duration_seconds")
      .in("id", ids.slice(from, from + ID_BATCH));
    if (error) throw new Error(`Could not load the plan's tracks: ${error.message}`);
    for (const row of (data ?? []) as { id: string; duration_seconds: number | string }[]) durations.set(row.id, Number(row.duration_seconds));
  }
  const locations = await listRekordboxLocations(supabase, ids);
  return items.map((i) => ({
    title: i.title,
    artist: i.artist,
    durationSeconds: durations.get(i.trackId) ?? null,
    location: locations.get(i.trackId) ?? null,
  }));
}

/** Most recent revisions across the library, newest first. */
export async function listRecentAnnotations(supabase: ServerClient, limit = 8): Promise<Annotation[]> {
  const { data, error } = await supabase.from("annotations").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return ((data ?? []) as AnnotationRow[]).map(toAnnotation);
}

/**
 * When each revision and saved analysis was made since `sinceIso`, for the activity calendar.
 * Pages through both tables (PostgREST caps a response at 1,000 rows) up to a bound that a year
 * of heavy use stays under; a failed read contributes nothing rather than breaking the page.
 */
export async function listActivityTimestamps(supabase: ServerClient, sinceIso: string): Promise<string[]> {
  const PAGE = 1000;
  const MAX_PAGES = 20;
  const read = async (table: "annotations" | "track_analyses") => {
    const out: string[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from(table)
        .select("created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error || !data) break;
      out.push(...(data as { created_at: string }[]).map((r) => r.created_at));
      if (data.length < PAGE) break;
    }
    return out;
  };
  const [annotations, analyses] = await Promise.all([read("annotations"), read("track_analyses")]);
  return [...annotations, ...analyses];
}

export interface RecentAnalysis {
  trackId: string;
  title: string;
  createdAt: string;
}

/** Latest saved analyses with their track titles, and the total number saved. */
export async function listRecentAnalyses(supabase: ServerClient, limit = 5): Promise<{ recent: RecentAnalysis[]; total: number }> {
  const { data, count, error } = await supabase
    .from("track_analyses")
    .select("track_id, created_at, tracks(title)", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { recent: [], total: 0 };
  const rows = (data ?? []) as unknown as { track_id: string; created_at: string; tracks: { title: string } | { title: string }[] | null }[];
  return {
    total: count ?? rows.length,
    recent: rows.map((r) => ({
      trackId: r.track_id,
      createdAt: r.created_at,
      title: (Array.isArray(r.tracks) ? r.tracks[0]?.title : r.tracks?.title) ?? "Untitled track",
    })),
  };
}
