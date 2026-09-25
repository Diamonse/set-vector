"use server";

import { revalidatePath } from "next/cache";
import { recordAnnotation } from "@/lib/data/annotations";
import { requireUser } from "@/lib/supabase/server";
import { cueFormSchema, fieldErrors, isUuid, type ActionState } from "@/lib/validation/schemas";

function cueValues(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  return {
    kind: get("kind"),
    start: get("start"),
    end: get("end"),
    label: get("label"),
    provenance: get("provenance") || "reviewed",
    review_status: get("review_status") || "approved",
    vocal_activity: get("vocal_activity") || "unknown",
  };
}

function friendly(message: string): string {
  if (message.includes("beyond track duration")) return "The region extends past the end of the track.";
  return message;
}

export async function createCue(trackId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(trackId)) return { ok: false, message: "Unknown track." };
  const parsed = cueFormSchema.safeParse(cueValues(formData));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const v = parsed.data;
  const { data, error } = await supabase
    .from("cue_regions")
    .insert({
      track_id: trackId,
      kind: v.kind,
      start_seconds: v.start,
      end_seconds: v.end,
      label: v.label,
      provenance: v.provenance,
      review_status: v.review_status,
      vocal_activity: v.vocal_activity,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: friendly(error.message) };

  await recordAnnotation(supabase, {
    level: "region",
    task: `${v.kind}_cue`,
    trackId,
    subject: (data as { id: string }).id,
    regionStartSeconds: v.start,
    regionEndSeconds: v.end,
    isEstimate: v.provenance === "estimate",
    payload: { action: "created", review_status: v.review_status, vocal_activity: v.vocal_activity, label: v.label },
  });
  revalidatePath(`/library/${trackId}`);
  return { ok: true, message: "Cue region added." };
}

export async function updateCue(trackId: string, cueId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(trackId) || !isUuid(cueId)) return { ok: false, message: "Unknown cue." };
  const parsed = cueFormSchema.safeParse(cueValues(formData));
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const v = parsed.data;
  const { error } = await supabase
    .from("cue_regions")
    .update({
      kind: v.kind,
      start_seconds: v.start,
      end_seconds: v.end,
      label: v.label,
      provenance: v.provenance,
      review_status: v.review_status,
      vocal_activity: v.vocal_activity,
    })
    .eq("id", cueId)
    .eq("track_id", trackId);
  if (error) return { ok: false, message: friendly(error.message) };

  await recordAnnotation(supabase, {
    level: "region",
    task: `${v.kind}_cue`,
    trackId,
    subject: cueId,
    regionStartSeconds: v.start,
    regionEndSeconds: v.end,
    isEstimate: v.provenance === "estimate",
    payload: { action: "revised", review_status: v.review_status, vocal_activity: v.vocal_activity, label: v.label },
  });
  revalidatePath(`/library/${trackId}`);
  return { ok: true, message: "Cue region updated." };
}

export async function deleteCue(trackId: string, cueId: string): Promise<ActionState> {
  if (!isUuid(trackId) || !isUuid(cueId)) return { ok: false, message: "Unknown cue." };
  const { supabase } = await requireUser();
  const { data: cue } = await supabase.from("cue_regions").select("*").eq("id", cueId).maybeSingle();
  const { error } = await supabase.from("cue_regions").delete().eq("id", cueId).eq("track_id", trackId);
  if (error) return { ok: false, message: error.message };
  if (cue) {
    const c = cue as { kind: string; start_seconds: number; end_seconds: number };
    await recordAnnotation(supabase, {
      level: "region",
      task: `${c.kind}_cue`,
      trackId,
      subject: cueId,
      regionStartSeconds: Number(c.start_seconds),
      regionEndSeconds: Number(c.end_seconds),
      payload: { action: "deleted" },
    });
  }
  revalidatePath(`/library/${trackId}`);
  return { ok: true, message: "Cue region deleted." };
}
