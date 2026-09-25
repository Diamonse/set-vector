"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAnnotation } from "@/lib/data/annotations";
import { requireUser } from "@/lib/supabase/server";
import { fieldErrors, isUuid, trackFormSchema, type ActionState, type TrackInsert } from "@/lib/validation/schemas";

function formValues(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return {
    title: get("title"),
    artist: get("artist"),
    version_label: get("version_label"),
    remix_group: get("remix_group"),
    duration: get("duration"),
    style_tags: get("style_tags"),
    bpm: get("bpm"),
    bpm_alternatives: get("bpm_alternatives"),
    bpm_source: get("bpm_source") || "reviewed",
    key: get("key"),
    key_status: get("key_status") || "unknown",
    energy: get("energy"),
    energy_source: get("energy_source") || "reviewed",
    asset_id: get("asset_id"),
    feature_id: get("feature_id"),
    notes: get("notes"),
  };
}

function friendly(message: string): string {
  if (message.includes("tracks_owner_asset_idx")) return "Another track already uses this asset ID.";
  if (message.includes("would leave existing cue regions")) return "Shorten or delete cue regions that extend past the new duration first.";
  return message;
}

const REVIEWED_FIELDS: (keyof TrackInsert)[] = [
  "duration_seconds",
  "style_tags",
  "bpm",
  "bpm_alternatives",
  "bpm_source",
  "key_tonic",
  "key_mode",
  "key_status",
  "energy",
  "energy_source",
  "remix_group",
];

export async function createTrack(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = trackFormSchema.safeParse(formValues(formData));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("tracks").insert(parsed.data).select("id").single();
  if (error) return { ok: false, message: friendly(error.message) };

  const id = (data as { id: string }).id;
  await recordAnnotation(supabase, {
    level: "track",
    task: "track_metadata",
    trackId: id,
    payload: { values: parsed.data, reason: "created" },
  });
  revalidatePath("/library");
  redirect(`/library/${id}`);
}

export async function updateTrack(trackId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(trackId)) return { ok: false, message: "Unknown track." };
  const parsed = trackFormSchema.safeParse(formValues(formData));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const { data: before, error: loadError } = await supabase.from("tracks").select("*").eq("id", trackId).maybeSingle();
  if (loadError || !before) return { ok: false, message: "Track not found." };

  const { error } = await supabase.from("tracks").update(parsed.data).eq("id", trackId);
  if (error) return { ok: false, message: friendly(error.message) };

  const previous = before as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of REVIEWED_FIELDS) {
    const from = previous[field];
    const to = parsed.data[field];
    const same = JSON.stringify(normalizeValue(from)) === JSON.stringify(normalizeValue(to));
    if (!same) changes[field] = { from, to };
  }
  if (Object.keys(changes).length > 0) {
    await recordAnnotation(supabase, {
      level: "track",
      task: "track_metadata",
      trackId,
      payload: { changes },
      note: String(formData.get("change_reason") ?? ""),
    });
  }
  revalidatePath("/library");
  revalidatePath(`/library/${trackId}`);
  return { ok: true, message: Object.keys(changes).length ? "Saved. The change was recorded as a new revision." : "Saved." };
}

function normalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x));
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v ?? null;
}

export async function deleteTrack(trackId: string): Promise<void> {
  if (!isUuid(trackId)) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tracks").delete().eq("id", trackId);
  if (error) throw new Error(`Could not delete the track: ${error.message}`);
  revalidatePath("/library");
  redirect("/library");
}

