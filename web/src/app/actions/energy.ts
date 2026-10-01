"use server";

import { revalidatePath } from "next/cache";
import { refreshEnergyEstimates } from "@/lib/data/energy";
import { requireUser } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation/schemas";

/** Recompute every automatic energy estimate in the library. */
export async function recalculateEnergy(_prev: ActionState): Promise<ActionState> {
  const { supabase } = await requireUser();
  const { changed, error } = await refreshEnergyEstimates(supabase);
  if (error) return { ok: false, message: `Energy estimates could not be updated: ${error}` };
  revalidatePath("/library");
  return { ok: true, message: changed ? `Updated ${changed} energy estimate(s).` : "Energy estimates are up to date." };
}
