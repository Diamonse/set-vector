import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime } from "@/lib/domain/format";
import { listPlans } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage() {
  const { supabase } = await requireUser();
  const plans = await listPlans(supabase);
  return (
    <>
      <PageHeader
        title="Plans"
        lead="Ordered proposals with transition suggestions. Open one to inspect, judge, or edit it."
        actions={
          <Button asChild>
            <Link href="/plans/new">
              <Plus aria-hidden /> New plan
            </Link>
          </Button>
        }
      />
      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          action={
            <Button asChild>
              <Link href="/plans/new">Plan a set</Link>
            </Button>
          }
        >
          Choose a crate or pool, a mode, and an energy arc. The planner proposes an order and explains each transition.
        </EmptyState>
      ) : (
        <div className="rounded-[12px] border border-divider bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Tracks</TableHead>
                <TableHead className="text-right">Length</TableHead>
                <TableHead>Constraints</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/plans/${p.id}`} className="font-semibold">
                      {p.name}
                    </Link>
                    {p.edited ? <span className="text-caption text-muted"> · edited</span> : null}
                  </TableCell>
                  <TableCell>
                    {p.mode === "dj" ? "DJ preparation" : "Listening flow"}
                    <div className="text-caption text-muted">{p.selectionPolicy === "use_all" ? "Fixed crate" : "Pool selection"}</div>
                  </TableCell>
                  <TableCell className="text-right text-data">{p.trackCount}</TableCell>
                  <TableCell className="text-right text-data">{formatTime(p.totalSeconds)}</TableCell>
                  <TableCell>
                    {p.violationCount ? <StatusBadge kind="review" label={`${p.violationCount} unsatisfied`} /> : <StatusBadge kind="reviewed" label="Satisfied" />}
                  </TableCell>
                  <TableCell className="text-caption whitespace-nowrap">
                    <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString()}</time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
