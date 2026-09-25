import "server-only";
import type { AnnotationLevel } from "@/lib/domain/types";
import type { ServerClient } from "@/lib/supabase/server";

export interface AnnotationInput {
  level: AnnotationLevel;
  task: string;
  trackId?: string | null;
  toTrackId?: string | null;
  planId?: string | null;
  regionStartSeconds?: number | null;
  regionEndSeconds?: number | null;
  isEstimate?: boolean;
  payload?: Record<string, unknown>;
  note?: string;
  /** Scope key within the payload used to find the superseded revision, e.g. a cue ID. */
  subject?: string;
}

/**
 * Appends an annotation. When an earlier annotation covers the same level,
 * task, tracks, plan, and subject, the new one records it as superseded.
 */
export async function recordAnnotation(supabase: ServerClient, input: AnnotationInput): Promise<void> {
  let query = supabase
    .from("annotations")
    .select("id, revision")
    .eq("level", input.level)
    .eq("task", input.task)
    .order("created_at", { ascending: false })
    .limit(1);
  query = input.trackId ? query.eq("track_id", input.trackId) : query.is("track_id", null);
  query = input.toTrackId ? query.eq("to_track_id", input.toTrackId) : query.is("to_track_id", null);
  query = input.planId ? query.eq("plan_id", input.planId) : query.is("plan_id", null);
  if (input.subject) query = query.eq("payload->>subject", input.subject);
  const { data: previous } = await query.maybeSingle();

  const payload = { ...(input.payload ?? {}), ...(input.subject ? { subject: input.subject } : {}) };
  const { error } = await supabase.from("annotations").insert({
    level: input.level,
    task: input.task,
    track_id: input.trackId ?? null,
    to_track_id: input.toTrackId ?? null,
    plan_id: input.planId ?? null,
    region_start_seconds: input.regionStartSeconds ?? null,
    region_end_seconds: input.regionEndSeconds ?? null,
    is_estimate: input.isEstimate ?? false,
    payload,
    note: (input.note ?? "").slice(0, 2000),
    revision: previous ? (previous as { revision: number }).revision + 1 : 1,
    supersedes_id: previous ? (previous as { id: string }).id : null,
  });
  if (error) throw new Error(`Could not record the annotation: ${error.message}`);
}
