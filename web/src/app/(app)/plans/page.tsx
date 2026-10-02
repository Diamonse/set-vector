import { Disc3, Headphones, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
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
        readout={
          plans.length
            ? [
                { label: "Plans", value: plans.length, segment: true },
                { label: "Planned time", value: formatTime(plans.reduce((sum, p) => sum + p.totalSeconds, 0)), segment: true },
              ]
            : undefined
        }
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
              <li key={p.id} className="group pad isolate flex flex-col gap-4 p-5">
                <PixelCanvas />
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-[var(--screen)] text-[var(--led-orange)] shadow-[0_0_0_2px_var(--screen-bezel),inset_0_2px_6px_rgb(0_0_0/0.7)]">
                    <Icon className="size-5 transition-transform duration-700 group-hover:rotate-180" aria-hidden />
                  </span>
                  {p.violationCount ? <StatusBadge kind="review" label={`${p.violationCount} unsatisfied`} /> : <StatusBadge kind="reviewed" label="Satisfied" />}
                </div>
                <div>
                  <h2 className="text-card-title">
                    <Link
                      href={`/plans/${p.id}`}
                      data-pad-link
                      className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                    >
                      {p.name}
                    </Link>
                  </h2>
                  <p className="mt-1 text-caption text-muted">
                    {p.mode === "dj" ? "DJ preparation" : "Listening flow"} · {p.selectionPolicy === "use_all" ? "Fixed crate" : "Pool selection"}
                    {p.edited ? " · edited" : ""}
                  </p>
                </div>
                {/* The pad's own small screen, reading out the plan like a loaded deck. */}
                <dl className="deck-screen m-1 mt-auto grid grid-cols-3 gap-3 px-3 py-2.5">
                  <div>
                    <dt className="text-eyebrow text-muted">Tracks</dt>
                    <dd className="mt-1 font-segment text-[18px] leading-none text-ink tabular">{p.trackCount}</dd>
                  </div>
                  <div>
                    <dt className="text-eyebrow text-muted">Length</dt>
                    <dd className="mt-1 font-segment text-[18px] leading-none text-ink tabular">{formatTime(p.totalSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-eyebrow text-muted">Created</dt>
                    <dd className="mt-1 text-[14px] leading-[18px] text-body">
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
