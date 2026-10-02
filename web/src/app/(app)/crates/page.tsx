import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Platter } from "@/components/music/platter";
import { Button } from "@/components/ui/button";
import { HoverTransition } from "@/components/ui/hover-transition";
import { formatTime } from "@/lib/domain/format";
import { listCrates, listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Crates" };

export default async function CratesPage() {
  const { supabase } = await requireUser();
  const [crates, tracks] = await Promise.all([listCrates(supabase), listTracks(supabase)]);
  const durations = new Map(tracks.map((t) => [t.id, t.durationSeconds]));
  const titles = new Map(tracks.map((t) => [t.id, t.title]));

  return (
    <>
      <PageHeader
        title="Crates"
        lead="Groups of tracks to reorder as a fixed list, or to use as a pool the planner selects from."
        readout={crates.length ? [{ label: "Crates", value: crates.length, segment: true }] : undefined}
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
              <li key={c.id} className="pad flex flex-col gap-2 p-6">
                {/* The crate's screen: a sleeve at rest, its tracks loading in as the card is hovered or focused. */}
                <HoverTransition
                  aria-hidden
                  trigger="parent"
                  effect="strips"
                  direction="right"
                  duration={0.6}
                  className="deck-screen m-1 mb-3 h-28"
                  defaultComponent={
                    <div className="flex h-full items-center gap-4 px-4">
                      <Platter className="size-16">
                        <span className="font-segment text-[12px]">{c.trackIds.length}</span>
                      </Platter>
                      <div>
                        <p className="text-eyebrow text-muted">Crate</p>
                        <p className="mt-1 font-segment text-[20px] leading-none text-ink">{formatTime(total)}</p>
                      </div>
                    </div>
                  }
                  hoverComponent={
                    <ol className="flex h-full flex-col justify-center gap-1 bg-[var(--screen)] px-4 text-[13px]">
                      {c.trackIds.slice(0, 4).map((id, i) => (
                        <li key={id} className="flex items-baseline gap-2 truncate">
                          <span className="font-segment text-[11px] text-[var(--led-orange)]">{i + 1}</span>
                          <span className="truncate text-ink">{titles.get(id) ?? "Missing track"}</span>
                        </li>
                      ))}
                      {c.trackIds.length > 4 ? <li className="text-caption text-muted">+{c.trackIds.length - 4} more</li> : null}
                      {c.trackIds.length === 0 ? <li className="text-caption text-muted">No tracks yet</li> : null}
                    </ol>
                  }
                />
                <Link
                  href={`/crates/${c.id}`}
                  data-pad-link
                  className="text-card-title text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                >
                  {c.name}
                </Link>
                {c.description ? <p className="line-clamp-2 text-caption text-muted">{c.description}</p> : null}
                <p className="text-data text-muted">
                  {c.trackIds.length} tracks · {formatTime(total)} full length
                </p>
                <div className="relative z-10 mt-2">
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
