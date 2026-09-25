"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/server";
import { crateFormSchema, fieldErrors, isUuid, type ActionState } from "@/lib/validation/schemas";

function trackIdsFrom(formData: FormData): string[] {
  return [...new Set(formData.getAll("track_ids").map(String).filter(isUuid))];
}

async function replaceCrateTracks(supabase: ServerClient, crateId: string, trackIds: string[]): Promise<string | null> {
  const { error: deleteError } = await supabase.from("crate_tracks").delete().eq("crate_id", crateId);
  if (deleteError) return deleteError.message;
  if (trackIds.length === 0) return null;
  const { error } = await supabase
    .from("crate_tracks")
    .insert(trackIds.map((track_id, position) => ({ crate_id: crateId, track_id, position })));
  return error ? error.message : null;
}

export async function createCrate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = crateFormSchema.safeParse({ name: formData.get("name") ?? "", description: formData.get("description") ?? "" });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("crates").insert(parsed.data).select("id").single();
  if (error) return { ok: false, message: error.message };
  const id = (data as { id: string }).id;
  const trackError = await replaceCrateTracks(supabase, id, trackIdsFrom(formData));
  if (trackError) return { ok: false, message: `The crate was created but its tracks were not saved: ${trackError}` };
  revalidatePath("/crates");
  redirect(`/crates/${id}`);
}

export async function updateCrate(crateId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(crateId)) return { ok: false, message: "Unknown crate." };
  const parsed = crateFormSchema.safeParse({ name: formData.get("name") ?? "", description: formData.get("description") ?? "" });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const { supabase } = await requireUser();
  const { error } = await supabase.from("crates").update(parsed.data).eq("id", crateId);
  if (error) return { ok: false, message: error.message };
  const trackError = await replaceCrateTracks(supabase, crateId, trackIdsFrom(formData));
  if (trackError) return { ok: false, message: trackError };
  revalidatePath("/crates");
  revalidatePath(`/crates/${crateId}`);
  return { ok: true, message: "Crate saved." };
}

export async function deleteCrate(crateId: string): Promise<void> {
  if (!isUuid(crateId)) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("crates").delete().eq("id", crateId);
  if (error) throw new Error(`Could not delete the crate: ${error.message}`);
  revalidatePath("/crates");
  redirect("/crates");
}
