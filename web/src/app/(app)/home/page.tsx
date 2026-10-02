import { ArrowRight, AudioLines, Check, Disc3, FileUp, ListMusic, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Histogram, KeyWheel, StyleBars } from "@/components/home/charts";
import { describeAnnotation } from "@/components/library/annotation-list";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/domain/format";
import { listCrates, listPlans, listRecentAnalyses, listRecentAnnotations, listTracks } from "@/lib/data/queries";
import { bpmHistogram, energyHistogram, gettingStarted, keyCounts, libraryHealth, styleCounts } from "@/lib/home/stats";
import { requireUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Home" };

const ACTIONS = [
  { href: "/library/analyze", label: "Analyze audio", detail: "Tempo, key, energy, cues", Icon: AudioLines },
  { href: "/library/import/rekordbox", label: "Import Rekordbox", detail: "Grids and cue points", Icon: Disc3 },
  { href: "/library/import", label: "Import JSON or CSV", detail: "From a spreadsheet", Icon: FileUp },
  { href: "/crates/new", label: "New crate", detail: "Group tracks", Icon: Plus },
  { href: "/plans/new", label: "Plan a set", detail: "Order and transitions", Icon: ListMusic },
];

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

export default async function HomePage() {
  const { supabase, user } = await requireUser();
  const [tracks, plans, crates, analyses, annotations, profile] = await Promise.all([
    listTracks(supabase),
    listPlans(supabase),
    listCrates(supabase),
    listRecentAnalyses(supabase),
    listRecentAnnotations(supabase, 6),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const name = (profile.data as { display_name: string | null } | null)?.display_name?.trim();
  const health = libraryHealth(tracks);
  const steps = gettingStarted({ tracks, analyses: analyses.total, crates: crates.length, plans: plans.length });
  const doneSteps = steps.filter((s) => s.done).length;
  const titles = new Map(tracks.map((t) => [t.id, t.title]));
  const n = health.tracks;
  const share = (k: number) => (n ? k / n : 0);
  const pct = (k: number) => `${Math.round(share(k) * 100)}%`;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        title={name ? `Welcome back, ${name}` : "Welcome back"}
        lead={
          n
            ? `${n} track${n === 1 ? "" : "s"} and ${formatTime(health.totalSeconds)} of music in your library, ${crates.length} crate${crates.length === 1 ? "" : "s"}, and ${plans.length} plan${plans.length === 1 ? "" : "s"}.`
            : "Start by bringing in some music. Audio is analyzed in your browser and never uploaded."
        }
      />

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="sr-only">
          Quick actions
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ACTIONS.map(({ href, label, detail, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full flex-col gap-3 panel p-4 text-ink no-underline transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-action/40 hover:text-ink hover:shadow-lift"
              >
                <span className="flex size-10 items-center justify-center rounded-inset border border-action/30 bg-action/10 text-action">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-ui">{label}</span>
                  <span className="block text-caption text-muted">{detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {doneSteps < steps.length ? (
        <Card className="mt-8">
          <CardHeader>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <CardTitle>Getting started</CardTitle>
              <span className="text-caption text-muted">
                {doneSteps} of {steps.length} done
              </span>
            </div>
            <div aria-hidden className="mt-2 flex gap-1">
              {steps.map((s) => (
                <span key={s.id} className={cn("h-1.5 flex-1 rounded-full", s.done ? "bg-action" : "bg-surface-subtle")} />
              ))}
            </div>
            <CardDescription>This card hides once every step is done.</CardDescription>
          </CardHeader>
          <ol className="flex flex-col divide-y divide-divider">
            {steps.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[13px]",
                      s.done ? "border-success/40 bg-success/10 text-success" : "border-divider text-muted",
                    )}
                  >
                    {s.done ? <Check className="size-4" aria-label="Done" /> : i + 1}
                  </span>
                  <div>
                    <p className={cn("text-ui", s.done ? "text-muted line-through" : "text-ink")}>{s.title}</p>
                    <p className="text-caption text-muted">{s.detail}</p>
                  </div>
                </div>
                {!s.done ? (
                  <Button asChild size="sm" variant="secondary" className="self-start sm:self-auto">
                    <Link href={s.href}>
                      {s.action} <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {n > 0 ? (
        <>
          <section aria-labelledby="health-heading" className="mt-10">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 id="health-heading" className="text-card-title">
                Library health
              </h2>
              {health.needsReview ? (
                <Link href="/library?review=needs" className="inline-flex items-center gap-1 text-ui">
                  {health.needsReview} track{health.needsReview === 1 ? "" : "s"} need review <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : (
                <StatusBadge kind="reviewed" label="Everything reviewed" />
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Tempo" value={pct(health.withTempo)} meter={share(health.withTempo)} detail={`${health.withTempo} of ${n} tracks have a BPM`} />
              <MetricCard label="Usable key" value={pct(health.withKey)} meter={share(health.withKey)} detail={`${health.withKey} of ${n}; uncertain keys are left out`} />
              <MetricCard
                label="Energy"
                value={pct(health.withEnergy)}
                meter={share(health.withEnergy)}
                detail={`${health.withEnergy} of ${n}, ${health.estimatedEnergy} from the automatic estimate`}
              />
              <MetricCard label="Cue ready" value={pct(health.cueReady)} meter={share(health.cueReady)} detail={`${health.cueReady} of ${n} with approved entry and exit`} />
            </div>
          </section>

          <section aria-labelledby="charts-heading" className="mt-10">
            <h2 id="charts-heading" className="mb-4 text-card-title">
              Your music at a glance
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Tempo</CardTitle>
                  <CardDescription>Tracks per 5 BPM; hover a bar for its count.</CardDescription>
                </CardHeader>
                <Histogram bins={bpmHistogram(tracks)} title="Tempo distribution" unit="BPM" empty="No tempos yet. Analyze audio or import BPMs." />
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Keys</CardTitle>
                  <CardDescription>How your library spreads over the Camelot wheel.</CardDescription>
                </CardHeader>
                <KeyWheel keys={keyCounts(tracks)} />
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Energy</CardTitle>
                  <CardDescription>Your ratings and the automatic estimates, rounded to whole steps.</CardDescription>
                </CardHeader>
                <Histogram bins={energyHistogram(tracks)} title="Energy distribution" unit="Energy" empty="No energy values yet. Analyze audio for automatic estimates." />
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Styles</CardTitle>
                  <CardDescription>Tracks per style tag.</CardDescription>
                </CardHeader>
                <StyleBars styles={styleCounts(tracks)} />
              </Card>
            </div>
          </section>
        </>
      ) : null}

      <section aria-labelledby="recent-heading" className="mt-10">
        <h2 id="recent-heading" className="mb-4 text-card-title">
          Recent activity
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle>Plans</CardTitle>
                <Link href="/plans" className="text-caption">
                  All plans
                </Link>
              </div>
            </CardHeader>
            {plans.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {plans.slice(0, 4).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/plans/${p.id}`} className="block truncate font-semibold text-ink no-underline hover:text-action">
                        {p.name}
                      </Link>
                      <span className="text-caption text-muted">
                        {p.mode === "dj" ? "DJ preparation" : "Listening flow"} · {p.trackCount} tracks · {formatTime(p.totalSeconds)}
                      </span>
                    </div>
                    <span className="shrink-0 text-caption text-muted">{when(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted">
                No plans yet. <Link href="/plans/new">Plan a set</Link>
              </p>
            )}
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle>Recently analyzed</CardTitle>
                <Link href="/library/analyze" className="text-caption">
                  Analyze more
                </Link>
              </div>
            </CardHeader>
            {analyses.recent.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {analyses.recent.map((a) => (
                  <li key={`${a.trackId}${a.createdAt}`} className="flex items-center justify-between gap-3 py-2.5">
                    <Link href={`/library/${a.trackId}`} className="truncate text-ink no-underline hover:text-action">
                      {a.title}
                    </Link>
                    <span className="shrink-0 text-caption text-muted">{when(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted">
                Nothing analyzed yet. <Link href="/library/analyze">Analyze audio</Link>
              </p>
            )}
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle>Recent changes</CardTitle>
                <Link href="/library" className="text-caption">
                  Library
                </Link>
              </div>
            </CardHeader>
            {annotations.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {annotations.map((a) => {
                  const title = a.trackId ? titles.get(a.trackId) : null;
                  return (
                    <li key={a.id} className="flex flex-col gap-0.5 py-2.5">
                      <span className="text-[14px] text-ink">
                        {title && a.trackId ? (
                          <Link href={`/library/${a.trackId}`} className="font-semibold text-ink no-underline hover:text-action">
                            {title}
                          </Link>
                        ) : null}
                        {title ? ": " : ""}
                        {describeAnnotation(a)}
                      </span>
                      <span className="text-caption text-muted">
                        {a.isEstimate ? "Automatic" : "Your change"} · {when(a.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-caption text-muted">No changes recorded yet.</p>
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
