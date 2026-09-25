"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { recordAnnotation } from "@/lib/data/annotations";
import { getPlan, listTracks } from "@/lib/data/queries";
import { toPlannerTrack } from "@/lib/data/rows";
import { evaluateEditedOrder, planSet, PlanRequestError, type EvaluatedPlan, type PlanResult } from "@/lib/planner";
import type { ServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/server";
import { createPlanSchema } from "@/lib/validation/plan-request";
import { isUuid, type ActionState } from "@/lib/validation/schemas";

function itemRows(plan: EvaluatedPlan) {
  return plan.items.map((item) => ({
    position: item.position,
    occurrence_id: item.occurrenceId,
    track_id: item.trackId,
    entry_cue_id: item.entryOptionId,
    exit_cue_id: item.exitOptionId,
    play_start_seconds: item.playStartSeconds,
    play_end_seconds: item.playEndSeconds,
    elapsed_start_seconds: item.elapsedStartSeconds,
  }));
}

async function saveProposal(supabase: ServerClient, planId: string, result: PlanResult): Promise<string | null> {
  const { error } = await supabase.rpc("replace_plan_items", {
    p_plan_id: planId,
    p_items: itemRows(result.proposal),
    p_result: result,
  });
  return error ? error.message : null;
}

export async function createPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, message: "The plan request could not be read." };
  }
  const parsed = createPlanSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join(" ") };
  }

  const { supabase } = await requireUser();
  const tracks = (await listTracks(supabase)).map(toPlannerTrack);

  let result: PlanResult;
  try {
    result = planSet(tracks, parsed.data.request);
  } catch (e) {
    if (e instanceof PlanRequestError) return { ok: false, message: e.problems.map((p) => p.message).join(" ") };
    throw e;
  }

  const { data, error } = await supabase
    .from("plans")
    .insert({
      name: parsed.data.name,
      mode: parsed.data.request.mode,
      selection_policy: parsed.data.request.selectionPolicy,
      crate_id: parsed.data.crateId,
      request: parsed.data.request,
      result,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `The plan was computed but not saved: ${error.message}` };
  const planId = (data as { id: string }).id;

  if (result.proposal.items.length > 0) {
    const { error: itemsError } = await supabase
      .from("plan_items")
      .insert(itemRows(result.proposal).map((row) => ({ ...row, plan_id: planId })));
    if (itemsError) return { ok: false, message: `The plan was saved without its items: ${itemsError.message}` };
  }

  revalidatePath("/plans");
  redirect(`/plans/${planId}`);
}

const editSchema = z.object({
  order: z.array(z.uuid()).min(1).max(500),
  reason: z.string().trim().max(2000),
});

export async function saveEditedOrder(planId: string, order: string[], reason: string): Promise<ActionState> {
  if (!isUuid(planId)) return { ok: false, message: "Unknown plan." };
  const parsed = editSchema.safeParse({ order, reason });
  if (!parsed.success) return { ok: false, message: "The edited order is not valid." };

  const { supabase } = await requireUser();
  const plan = await getPlan(supabase, planId);
  if (!plan) return { ok: false, message: "Plan not found." };

  const tracks = (await listTracks(supabase)).map(toPlannerTrack);
  const edited = evaluateEditedOrder(tracks, plan.request, parsed.data.order);
  const previousOrder = plan.result.proposal.items.map((i) => i.trackId);
  const result: PlanResult = { ...plan.result, proposal: edited };

  const error = await saveProposal(supabase, planId, result);
  if (error) return { ok: false, message: error };

  await recordAnnotation(supabase, {
    level: "sequence",
    task: "manual_reorder",
    planId,
    payload: {
      previous_order: previousOrder,
      new_order: parsed.data.order,
      objective_before: plan.result.proposal.objective.total,
      objective_after: edited.objective.total,
    },
    note: parsed.data.reason,
  });
  revalidatePath(`/plans/${planId}`);
  return { ok: true, message: `Saved. ${edited.violations.length} constraint issue(s) in the edited order.` };
}

export async function adoptAlternative(planId: string, index: number): Promise<ActionState> {
  if (!isUuid(planId) || !Number.isInteger(index) || index < 0) return { ok: false, message: "Unknown alternative." };
  const { supabase } = await requireUser();
  const plan = await getPlan(supabase, planId);
  const chosen = plan?.result.alternatives[index];
  if (!plan || !chosen) return { ok: false, message: "Alternative not found." };

  const alternatives = plan.result.alternatives.slice();
  alternatives[index] = { ...plan.result.proposal, label: `Alternative ${index + 1}` };
  const result: PlanResult = { ...plan.result, proposal: { ...chosen, label: "Proposed plan" }, alternatives };
  const error = await saveProposal(supabase, planId, result);
  if (error) return { ok: false, message: error };

  await recordAnnotation(supabase, {
    level: "sequence",
    task: "adopt_alternative",
    planId,
    payload: { alternative_index: index },
  });
  revalidatePath(`/plans/${planId}`);
  return { ok: true, message: "Alternative adopted as the proposal." };
}

const judgmentSchema = z.object({
  fromTrackId: z.uuid(),
  toTrackId: z.uuid(),
  judgment: z.enum(["works", "needs_adjustment", "clash"]),
  note: z.string().trim().max(2000),
});

export async function judgeTransition(planId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isUuid(planId)) return { ok: false, message: "Unknown plan." };
  const parsed = judgmentSchema.safeParse({
    fromTrackId: formData.get("from_track_id"),
    toTrackId: formData.get("to_track_id"),
    judgment: formData.get("judgment"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "Choose a judgment." };

  const { supabase } = await requireUser();
  await recordAnnotation(supabase, {
    level: "pair",
    task: "transition_judgment",
    trackId: parsed.data.fromTrackId,
    toTrackId: parsed.data.toTrackId,
    planId,
    payload: {
      judgment: parsed.data.judgment,
      exit_option_id: formData.get("exit_option_id"),
      entry_option_id: formData.get("entry_option_id"),
    },
    note: parsed.data.note,
  });
  revalidatePath(`/plans/${planId}`);
  return { ok: true, message: "Judgment recorded." };
}

export async function deletePlan(planId: string): Promise<void> {
  if (!isUuid(planId)) return;
  const { supabase } = await requireUser();
  const { error } = await supabase.from("plans").delete().eq("id", planId);
  if (error) throw new Error(`Could not delete the plan: ${error.message}`);
  revalidatePath("/plans");
  redirect("/plans");
}
