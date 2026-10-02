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
import { LedCalendar } from "@/components/ui/led-calendar";
import { PixelCanvas } from "@/components/ui/pixel-canvas";
import { SplitFlapDisplay } from "@/components/ui/split-flap-display";
import { formatTime } from "@/lib/domain/format";
import { listActivityTimestamps, listCrates, listPlans, listRecentAnalyses, listRecentAnnotations, listTracks } from "@/lib/data/queries";
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
  // A year and a week back, so the calendar's first column is full whatever today's weekday.
  const since = new Date(Date.now() - 372 * 86_400_000).toISOString();
  const [tracks, plans, crates, analyses, annotations, profile, activity] = await Promise.all([
    listTracks(supabase),
    listPlans(supabase),
    listCrates(supabase),
    listRecentAnalyses(supabase),
    listRecentAnnotations(supabase, 6),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    listActivityTimestamps(supabase, since),
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
        lead={n ? undefined : "Start by bringing in some music. Audio is analyzed in your browser and never uploaded."}
        readout={
          n
            ? [
                { label: "Tracks", value: n, segment: true },
                { label: "Music", value: formatTime(health.totalSeconds), segment: true },
                { label: "Crates", value: crates.length, segment: true },
                { label: "Plans", value: plans.length, segment: true },
              ]
            : undefined
        }
      />

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="sr-only">
          Quick actions
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ACTIONS.map(({ href, label, detail, Icon }) => (
            // Each action is a rubber pad: the whole pad presses with its link, like the plans list.
            <li key={href} className="pad isolate flex h-full flex-col gap-3 p-4">
              <PixelCanvas />
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--screen)] text-[var(--led-orange)] shadow-[0_0_0_2px_var(--screen-bezel),inset_0_2px_6px_rgb(0_0_0/0.7)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span>
                <Link
                  href={href}
                  data-pad-link
                  className="block text-ui text-ink no-underline after:absolute after:inset-0 after:rounded-card hover:text-ink focus-visible:outline-none"
                >
                  {label}
                </Link>
                <span className="block text-caption text-muted">{detail}</span>
              </span>
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
            {/* One LED per step, lit green when done, like a deck's status lamps. */}
            <div aria-hidden className="mt-2 flex gap-1.5">
              {steps.map((s) => (
                <span
                  key={s.id}
                  className={cn(
                    "h-2 flex-1 rounded-[2px]",
                    s.done ? "bg-[var(--led-green)] shadow-[0_0_8px_var(--led-green)]" : "bg-[var(--key-well)] shadow-[inset_0_1px_2px_var(--key-shade)]",
                  )}
                />
              ))}
            </div>
            <CardDescription>This card hides once every step is done.</CardDescription>
          </CardHeader>
          <ol className="flex flex-col divide-y divide-divider">
            {steps.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  {/* Hot-cue pads: lit green once the step is done. */}
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px] font-mono text-[13px] font-bold",
                      s.done ? "key-lit [--led:var(--led-green)]" : "key text-muted",
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

      {plans[0] ? (
        <section aria-labelledby="latest-plan-heading" className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 id="latest-plan-heading" className="text-card-title">
              Latest plan
            </h2>
            <Link href={`/plans/${plans[0].id}`} className="inline-flex items-center gap-1 text-ui">
              Open plan <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          {/* A departure board for the newest plan: name, size, and length flip into place. */}
          <SplitFlapDisplay
            rows={[plans[0].name, `${plans[0].trackCount} tracks`, `Length ${formatTime(plans[0].totalSeconds)}`]}
            label={`Latest plan: ${plans[0].name}, ${plans[0].trackCount} tracks, ${formatTime(plans[0].totalSeconds)} long.`}
            columns={20}
          />
        </section>
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

      <section aria-labelledby="activity-heading" className="mt-10">
        <h2 id="activity-heading" className="mb-4 text-card-title">
          Activity
        </h2>
        <LedCalendar timestamps={activity} noun="change" />
      </section>

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
