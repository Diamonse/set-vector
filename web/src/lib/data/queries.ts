import "server-only";
import type { Annotation, Crate, Track } from "@/lib/domain/types";
import type { PlanRequest, PlanResult } from "@/lib/planner";
import type { ServerClient } from "@/lib/supabase/server";
import { toAnnotation, toCrate, toTrack, type AnnotationRow, type CrateRow, type TrackRow } from "./rows";

const TRACK_SELECT = "*, cue_regions(*)";
const PAGE = 1000;

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
