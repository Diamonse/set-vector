import { AudioLines, Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { TrackTable } from "@/components/library/track-table";
import { Button } from "@/components/ui/button";
import { usableKey } from "@/lib/domain/camelot";
import { formatPercent, formatTime } from "@/lib/domain/format";
import { RecalculateEnergy } from "@/components/energy/recalculate-energy";
import { loadLibraryEnergy } from "@/lib/data/energy";
import { listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const params = await searchParams;
  const initialReview = params.review === "needs" || params.review === "complete" ? params.review : "all";
  const { supabase } = await requireUser();
  const [tracks, libraryEnergy] = await Promise.all([listTracks(supabase), loadLibraryEnergy(supabase).catch(() => null)]);
  const stale = libraryEnergy?.needsReanalysis.size ?? 0;
  const estimated = tracks.filter((t) => t.energyModel).length;
  const n = tracks.length;
  const share = (count: number) => (n === 0 ? "0%" : formatPercent(count / n, 0));

  const withKey = tracks.filter((t) => usableKey(t.keyTonic, t.keyMode, t.keyStatus)).length;
  const totalSeconds = tracks.reduce((sum, t) => sum + t.durationSeconds, 0);
  const withTempo = tracks.filter((t) => t.bpm !== null).length;
  const withEnergy = tracks.filter((t) => t.energy !== null).length;
  const withCues = tracks.filter(
    (t) => t.cues.some((c) => c.kind === "entry" && c.reviewStatus === "approved") && t.cues.some((c) => c.kind === "exit" && c.reviewStatus === "approved"),
  ).length;

  return (
    <>
      <PageHeader
        title="Library"
        lead="Track metadata and reviewed evidence. Analyze audio files in the browser, or import results from the offline CLI. Audio never leaves your device."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/library/import">
                <Upload aria-hidden /> Import
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/library/analyze">
                <AudioLines aria-hidden /> Analyze audio
              </Link>
            </Button>
            <Button asChild>
              <Link href="/library/new">
                <Plus aria-hidden /> Add track
              </Link>
            </Button>
          </>
        }
      />
      {n === 0 ? (
        <EmptyState
          title="Your library is empty"
          action={
            <>
              <Button asChild>
                <Link href="/library/analyze">Analyze audio files</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/library/import">Import JSON or CSV</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/library/import/rekordbox">Import from Rekordbox</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/library/new">Add a track by hand</Link>
              </Button>
            </>
          }
        >
          Add tracks with their duration, tempo, key, relative energy, and cue regions. Start with what you have already checked; the planner
          shows where evidence is missing.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-10">
          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="sr-only">
              Evidence coverage
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Tracks" value={n} detail={`${formatTime(totalSeconds)} of music`} />
              <MetricCard label="Usable key" value={share(withKey)} meter={withKey / n} detail={`${withKey} of ${n}; uncertain keys are excluded`} />
              <MetricCard
                label="Tempo and energy"
                value={share(Math.min(withTempo, withEnergy))}
                meter={Math.min(withTempo, withEnergy) / n}
                detail={`${withTempo} with tempo, ${withEnergy} with energy`}
              />
              <MetricCard label="Approved entry and exit" value={share(withCues)} meter={withCues / n} detail={`${withCues} of ${n} tracks ready for DJ cues`} />
            </div>
          </section>
          <section aria-labelledby="energy-heading" className="flex flex-col gap-3 panel p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="energy-heading" className="text-ui text-ink">
                Automatic energy
              </h2>
              <p className="text-caption text-muted">
                {estimated} track(s) use an estimate ranked against your analyzed tracks; your own ratings always win.
                {stale ? ` ${stale} track(s) were analyzed before drum activity was measured; analyze them again for full estimates.` : ""}
              </p>
            </div>
            <RecalculateEnergy />
          </section>
          <TrackTable tracks={tracks} initialReview={initialReview} />
        </div>
      )}
    </>
  );
}
