"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { recordAnnotation } from "@/lib/data/annotations";
import { fittingCues, planTrackUpdate } from "@/lib/analysis/apply";
import { saveAnalysisSchema, type SaveAnalysisInput } from "@/lib/analysis/schema";
import type { ServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/server";

export interface SaveOutcome {
  fileName: string;
  ok: boolean;
  trackId: string | null;
  created: boolean;
  message: string;
  applied: string[];
  kept: string[];
  warnings: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface TrackRowLite {
  id: string;
  asset_id: string | null;
  duration_seconds: number | string;
  bpm: number | string | null;
  bpm_source: "estimate" | "reviewed" | null;
  key_tonic: number | null;
  key_mode: "major" | "minor" | null;
  key_status: "unknown" | "estimated" | "reviewed" | "uncertain" | "not_meaningful";
}

const TRACK_FIELDS = "id, asset_id, duration_seconds, bpm, bpm_source, key_tonic, key_mode, key_status";

async function resolveTrack(supabase: ServerClient, input: SaveAnalysisInput): Promise<{ row: TrackRowLite; created: boolean } | { error: string }> {
  if (input.trackId) {
    const { data } = await supabase.from("tracks").select(TRACK_FIELDS).eq("id", input.trackId).maybeSingle();
    if (!data) return { error: "The chosen track was not found." };
    const row = data as TrackRowLite;
    if (row.asset_id && row.asset_id !== input.assetId) {
      return { error: "The chosen track is linked to a different audio file (asset ID mismatch)." };
    }
    if (!row.asset_id) {
      const { error } = await supabase.from("tracks").update({ asset_id: input.assetId }).eq("id", row.id);
      if (error) return { error: error.message.includes("tracks_owner_asset_idx") ? "Another track already uses this audio file." : error.message };
    }
    return { row, created: false };
  }
  const { data: existing } = await supabase.from("tracks").select(TRACK_FIELDS).eq("asset_id", input.assetId).maybeSingle();
  if (existing) return { row: existing as TrackRowLite, created: false };
  const { data, error } = await supabase
    .from("tracks")
    .insert({
      title: input.title,
      artist: input.artist,
      duration_seconds: Math.round(input.result.durationSeconds * 1000) / 1000,
      asset_id: input.assetId,
      notes: `Added from ${input.fileName.slice(0, 200)} by browser analysis.`,
    })
    .select(TRACK_FIELDS)
    .single();
  if (error) return { error: error.message };
  return { row: data as TrackRowLite, created: true };
}

async function saveOne(supabase: ServerClient, raw: unknown): Promise<SaveOutcome> {
  const parsed = saveAnalysisSchema.safeParse(raw);
  const fileName = typeof raw === "object" && raw && "fileName" in raw ? String((raw as { fileName: unknown }).fileName).slice(0, 200) : "file";
  const fail = (message: string): SaveOutcome => ({ fileName, ok: false, trackId: null, created: false, message, applied: [], kept: [], warnings: [] });
  if (!parsed.success) return fail("The analysis result was not valid and was not saved.");
  const input = parsed.data;

  const resolved = await resolveTrack(supabase, input);
  if ("error" in resolved) return fail(resolved.error);
  const { row, created } = resolved;

  const plan = planTrackUpdate(
    {
      durationSeconds: Number(row.duration_seconds),
      bpm: row.bpm === null ? null : Number(row.bpm),
      bpmSource: row.bpm_source,
      keyTonic: row.key_tonic,
      keyMode: row.key_mode,
      keyStatus: row.key_status,
    },
    input.result,
  );

  const analysisKey = createHash("sha256").update(canonical({ asset_id: input.assetId, extractor: input.result.extractor })).digest("hex");
  const { data: analysis, error: analysisError } = await supabase
    .from("track_analyses")
    .upsert(
      { track_id: row.id, asset_id: input.assetId, analysis_key: analysisKey, extractor: input.result.extractor, result: input.result },
      { onConflict: "owner_id,analysis_key" },
    )
    .select("id")
    .single();
  if (analysisError) {
    const hint = analysisError.message.includes("track_analyses") ? " Run the track_analyses migration in Supabase first." : "";
    return fail(`The analysis could not be stored: ${analysisError.message}.${hint}`);
  }
  const analysisId = (analysis as { id: string }).id;

  if (Object.keys(plan.patch).length) {
    const { error } = await supabase.from("tracks").update(plan.patch).eq("id", row.id);
    if (error) return fail(`The track could not be updated: ${error.message}`);
  }

  // Replace suggestions from earlier analyses that were never reviewed; keep everything else.
  const { error: deleteError } = await supabase
    .from("cue_regions")
    .delete()
    .eq("track_id", row.id)
    .not("analysis_id", "is", null)
    .eq("review_status", "pending")
    .eq("provenance", "estimate");
  if (deleteError) plan.warnings.push(`Earlier suggestions were not removed: ${deleteError.message}`);
  const { data: remaining } = await supabase.from("cue_regions").select("kind, start_seconds, end_seconds").eq("track_id", row.id);
  const existing = ((remaining ?? []) as { kind: "entry" | "exit"; start_seconds: number | string; end_seconds: number | string }[]).map((c) => ({
    kind: c.kind,
    startSeconds: Number(c.start_seconds),
    endSeconds: Number(c.end_seconds),
  }));
  const cues = fittingCues(input.result, Number(row.duration_seconds), existing);
  if (cues.length) {
    const { error } = await supabase.from("cue_regions").insert(
      cues.map((c) => ({
        track_id: row.id,
        kind: c.kind,
        start_seconds: c.startSeconds,
        end_seconds: c.endSeconds,
        label: c.label,
        provenance: "estimate",
        review_status: "pending",
        vocal_activity: "unknown",
        analysis_id: analysisId,
      })),
    );
    if (error) plan.warnings.push(`Cue suggestions were not saved: ${error.message}`);
    else plan.applied.push(`${cues.length} cue suggestion(s) pending review`);
  }

  await recordAnnotation(supabase, {
    level: "track",
    task: "audio_analysis",
    trackId: row.id,
    isEstimate: true,
    payload: {
      analysis_id: analysisId,
      extractor: `${input.result.extractor.name} v${input.result.extractor.version}`,
      model: input.result.extractor.model?.name ?? null,
      bpm: input.result.tempo.bpm,
      key: input.result.key.tonic === null ? null : { tonic: input.result.key.tonic, mode: input.result.key.mode, status: input.result.key.status },
      integrated_lufs: input.result.loudness.integratedLufs,
      applied: plan.applied,
      kept: plan.kept,
    },
  });

  return {
    fileName,
    ok: true,
    trackId: row.id,
    created,
    message: created ? "Added to the library." : "Updated the existing track.",
    applied: plan.applied,
    kept: plan.kept,
    warnings: plan.warnings,
  };
}

/** Saves browser analyses one by one; a failure affects only its own file. */
export async function saveAnalyses(items: unknown[]): Promise<SaveOutcome[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    return [{ fileName: "", ok: false, trackId: null, created: false, message: "Send between 1 and 50 analyses at a time.", applied: [], kept: [], warnings: [] }];
  }
  const { supabase } = await requireUser();
  const outcomes: SaveOutcome[] = [];
  for (const item of items) outcomes.push(await saveOne(supabase, item));
  revalidatePath("/library");
  for (const o of outcomes) if (o.trackId) revalidatePath(`/library/${o.trackId}`);
  return outcomes;
}
