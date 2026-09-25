import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { PlanRequestForm } from "@/components/plans/plan-request-form";
import { Button } from "@/components/ui/button";
import { listCrates, listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "New plan" };

export default async function NewPlanPage({ searchParams }: PageProps<"/plans/new">) {
  const params = await searchParams;
  const crateParam = typeof params.crate === "string" && isUuid(params.crate) ? params.crate : null;
  const { supabase } = await requireUser();
  const [tracks, crates] = await Promise.all([listTracks(supabase), listCrates(supabase)]);
  const pickerTracks = tracks.map(({ cues: _cues, notes: _notes, ...t }) => t);

  return (
    <>
      <PageHeader
        title="Plan a set"
        lead="The result is a proposal to inspect and edit. It suggests an order and transitions; it does not render a mix."
      />
      {tracks.length < 2 ? (
        <EmptyState
          title="Add at least two tracks first"
          action={
            <Button asChild>
              <Link href="/library/import">Import tracks</Link>
            </Button>
          }
        />
      ) : (
        <PlanRequestForm
          tracks={pickerTracks}
          crates={crates}
          initialCrateId={crateParam && crates.some((c) => c.id === crateParam) ? crateParam : null}
        />
      )}
    </>
  );
}
