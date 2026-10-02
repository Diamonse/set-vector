import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deletePlan } from "@/app/actions/plans";
import { ConfirmDelete } from "@/components/app/confirm-delete";
import { PageHeader } from "@/components/app/page-header";
import { PlanView } from "@/components/plans/plan-view";
import { SplitFlapDisplay } from "@/components/ui/split-flap-display";
import { formatTime } from "@/lib/domain/format";
import { getPlan, listPlanAnnotations, listTracks } from "@/lib/data/queries";
import { toPlannerTrack } from "@/lib/data/rows";
import { requireUser } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage({ params }: PageProps<"/plans/[planId]">) {
  const { planId } = await params;
  if (!isUuid(planId)) notFound();
  const { supabase } = await requireUser();
  const [plan, tracks, annotations] = await Promise.all([getPlan(supabase, planId), listTracks(supabase), listPlanAnnotations(supabase, planId)]);
  if (!plan) notFound();

  const proposal = plan.result.proposal;
  // Only tracks the request could use are sent to the editor.
  const candidates = new Set([...plan.request.candidateTrackIds, ...plan.result.proposal.items.map((i) => i.trackId)]);
  const plannerTracks = tracks.filter((t) => candidates.has(t.id)).map(toPlannerTrack);

  // Latest judgment per directed pair (annotations arrive newest first).
  const judgments: Record<string, string> = {};
  for (const a of annotations) {
    if (a.task !== "transition_judgment" || !a.trackId || !a.toTrackId) continue;
    const key = `${a.trackId}>${a.toTrackId}`;
    if (!(key in judgments) && typeof a.payload.judgment === "string") judgments[key] = a.payload.judgment;
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/plans" className="no-underline">
            Plans
          </Link>
        }
        title={plan.name}
        lead={`${plan.mode === "dj" ? "DJ preparation" : "Listening flow"} · ${plan.selectionPolicy === "use_all" ? "fixed crate" : "selected from a pool"}${plan.edited ? " · edited by you" : ""}`}
        actions={
          <ConfirmDelete
            title="Delete this plan?"
            description="The plan, its items, and its judgments are removed. Your tracks and crates stay."
            onConfirm={deletePlan.bind(null, plan.id)}
          />
        }
      />
      {/* The saved order on a departure board: where the set opens, where it closes, and how long it runs. */}
      <SplitFlapDisplay
        className="mb-8"
        columns={22}
        rows={[`Open  ${proposal.items[0]?.title ?? ""}`, `Close ${proposal.items.at(-1)?.title ?? ""}`, `${proposal.metrics.trackCount} tracks ${formatTime(proposal.metrics.totalSeconds)}`]}
        label={`Saved order: opens with ${proposal.items[0]?.title ?? "no track"}, closes with ${proposal.items.at(-1)?.title ?? "no track"}, ${proposal.metrics.trackCount} tracks, ${formatTime(proposal.metrics.totalSeconds)}.`}
      />
      <PlanView planId={plan.id} request={plan.request} result={plan.result} plannerTracks={plannerTracks} judgments={judgments} />
    </>
  );
}
