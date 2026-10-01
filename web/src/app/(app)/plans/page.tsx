import { Disc3, Headphones, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
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
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const Icon = p.mode === "dj" ? Disc3 : Headphones;
            return (
              <li key={p.id} className="group relative flex flex-col gap-4 panel p-5 transition-[box-shadow,transform,border-color] hover:-translate-y-0.5 hover:border-action/40 hover:shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-inset border border-action/30 bg-action/10 text-action">
                    <Icon className="size-5 transition-transform duration-700 group-hover:rotate-180" aria-hidden />
                  </span>
                  {p.violationCount ? <StatusBadge kind="review" label={`${p.violationCount} unsatisfied`} /> : <StatusBadge kind="reviewed" label="Satisfied" />}
                </div>
                <div>
                  <h2 className="text-card-title">
                    <Link href={`/plans/${p.id}`} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card hover:text-action">
                      {p.name}
                    </Link>
                  </h2>
                  <p className="mt-1 text-caption text-muted">
                    {p.mode === "dj" ? "DJ preparation" : "Listening flow"} · {p.selectionPolicy === "use_all" ? "Fixed crate" : "Pool selection"}
                    {p.edited ? " · edited" : ""}
                  </p>
                </div>
                <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-divider pt-4">
                  <div>
                    <dt className="text-eyebrow text-muted">Tracks</dt>
                    <dd className="font-mono text-[18px] font-semibold text-ink tabular">{p.trackCount}</dd>
                  </div>
                  <div>
                    <dt className="text-eyebrow text-muted">Length</dt>
                    <dd className="font-mono text-[18px] font-semibold text-ink tabular">{formatTime(p.totalSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-eyebrow text-muted">Created</dt>
                    <dd className="text-[14px] leading-7 text-body">
                      <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString()}</time>
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
