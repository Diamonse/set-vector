import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/domain/format";
import { listCrates, listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Crates" };

export default async function CratesPage() {
  const { supabase } = await requireUser();
  const [crates, tracks] = await Promise.all([listCrates(supabase), listTracks(supabase)]);
  const durations = new Map(tracks.map((t) => [t.id, t.durationSeconds]));

  return (
    <>
      <PageHeader
        title="Crates"
        lead="Groups of tracks to reorder as a fixed list, or to use as a pool the planner selects from."
        actions={
          <Button asChild>
            <Link href="/crates/new">
              <Plus aria-hidden /> New crate
            </Link>
          </Button>
        }
      />
      {crates.length === 0 ? (
        <EmptyState
          title="No crates yet"
          action={
            <Button asChild>
              <Link href="/crates/new">Create a crate</Link>
            </Button>
          }
        >
          A crate is a saved selection of tracks, such as tonight&apos;s shortlist or a warm-up pool.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {crates.map((c) => {
            const total = c.trackIds.reduce((s, id) => s + (durations.get(id) ?? 0), 0);
            return (
              <li key={c.id} className="flex flex-col gap-2 rounded-[12px] border border-divider bg-surface p-6">
                <Link href={`/crates/${c.id}`} className="text-card-title">
                  {c.name}
                </Link>
                {c.description ? <p className="line-clamp-2 text-caption text-muted">{c.description}</p> : null}
                <p className="text-data text-muted">
                  {c.trackIds.length} tracks · {formatTime(total)} full length
                </p>
                <div className="mt-2">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/plans/new?crate=${c.id}`}>Plan from this crate</Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
