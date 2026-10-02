import { ArrowRight, AudioLines, Disc3, FileUp, Headphones, ListChecks, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { KeyChip } from "@/components/music/key-chip";
import { WaveformArt } from "@/components/music/waveform-art";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  {
    Icon: AudioLines,
    title: "Analyze in the browser",
    body: "Tempo, beat grid, downbeats, key, loudness, and cue suggestions from your own files. Audio never leaves your device.",
  },
  {
    Icon: FileUp,
    title: "Bring your library",
    body: "Import a Rekordbox collection with its beat grids and cue points, or JSON and CSV from a spreadsheet or the offline analyzer.",
  },
  {
    Icon: Disc3,
    title: "DJ preparation",
    body: "Plans entry and exit regions, overlaps, and tempo changes, and suggests a cut, short blend, or long blend for each transition.",
  },
  {
    Icon: Headphones,
    title: "Listening flow",
    body: "Orders whole tracks for pacing and variety against an energy arc, for playlists that are meant to be heard start to finish.",
  },
  {
    Icon: ListChecks,
    title: "Explained, not magic",
    body: "Every transition lists its key relation, tempo change, cue status, and energy step. Missing evidence is shown, not hidden.",
  },
  {
    Icon: ShieldCheck,
    title: "Your corrections win",
    body: "Estimates and reviewed values stay separate. Analysis never overwrites what you checked, and every change is kept as a revision.",
  },
];

const STEPS = [
  { n: "A", title: "Analyze or import", body: "Drop audio files or a Rekordbox export." },
  { n: "B", title: "Review the evidence", body: "Confirm keys, tempos, and cue regions on the waveform." },
  { n: "C", title: "Plan and export", body: "Generate an order, edit it, and export CSV or JSON." },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Signed-in visitors get their dashboard; this page is the public introduction.
  if (user) redirect("/home");

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-divider/60 bg-[var(--header-bg)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <Link href="/" className="no-underline" aria-label="SetVector home">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle className="hidden sm:inline-flex" />
            {user ? (
              <Button asChild size="sm">
                <Link href="/home">Open SetVector</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/signup">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-14 pb-20 md:px-6 md:pt-24 lg:grid-cols-[1.1fr_1fr]">
          <div className="animate-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-divider bg-surface/70 px-3 py-1 text-eyebrow text-muted">
              <span aria-hidden className="size-1.5 rounded-full bg-action" />
              For DJs and playlist builders
            </p>
            <h1 className="mt-6 text-display max-w-[14ch]">
              Shape a set from{" "}
              <span className="text-action">evidence</span> you can inspect.
            </h1>
            <p className="mt-6 max-w-[56ch] text-lead text-body">
              Keep reviewed keys, tempos, cue regions, and energy notes for your library. Plan a DJ set or a listening playlist, see why each
              transition was suggested, and change anything the planner got wrong.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              {user ? (
                <Button asChild>
                  <Link href="/library">
                    Open your library <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button asChild>
                    <Link href="/signup">
                      Create an account <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild variant="secondary">
                    <Link href="/login">Sign in</Link>
                  </Button>
                </>
              )}
            </div>
          </div>

          <figure className="on-dark relative animate-rise overflow-hidden rounded-card border border-on-dark/10 bg-dark p-5 text-on-dark shadow-lift [animation-delay:120ms] md:p-6">
            <div aria-hidden className="absolute inset-0 stage-glow" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="text-eyebrow text-on-dark-muted">Example transition</span>
                <span className="rounded-full border border-action-on-dark/40 bg-action-on-dark/10 px-2.5 py-0.5 text-[12px] font-semibold text-action-on-dark">
                  Long blend · 32 beats
                </span>
              </div>
              {[
                { deck: "A", title: "Warm Room", artist: "Example Artist", bpm: "124.0", key: { tonic: 9, mode: "minor" as const }, seed: 1 },
                { deck: "B", title: "Late Signal", artist: "Second Artist", bpm: "125.0", key: { tonic: 4, mode: "minor" as const }, seed: 4 },
              ].map((d) => (
                <div key={d.deck} className="mt-4 rounded-inset border border-on-dark/10 bg-dark-elevated/80 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-control bg-on-dark/10 font-mono text-[13px] font-semibold text-on-dark">{d.deck}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-on-dark">{d.title}</p>
                      <p className="truncate text-caption text-on-dark-muted">{d.artist}</p>
                    </div>
                    <KeyChip musicalKey={d.key} className="text-on-dark" />
                    <span className="font-segment text-[14px] text-on-dark tabular">
                      {d.bpm}
                      <span className="sr-only font-sans text-[11px] text-on-dark-muted sm:not-sr-only sm:ml-1">BPM</span>
                    </span>
                  </div>
                  <WaveformArt seed={d.seed} bars={56} animated className="mt-3 h-14" />
                </div>
              ))}
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  ["Harmonic", "Adjacent"],
                  ["Tempo", "+0.8%"],
                  ["Energy", "6 → 7"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-inset border border-on-dark/10 bg-dark-elevated/60 px-2 py-3">
                    <dt className="text-eyebrow text-on-dark-muted">{k}</dt>
                    <dd className="mt-1 font-mono text-[15px] font-semibold text-on-dark">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <figcaption className="sr-only">
              An illustration of a planned transition between two example tracks: 8A to 9A, adjacent on the Camelot wheel, a 0.8% tempo change,
              and an energy step from 6 to 7.
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="features-heading" className="mx-auto max-w-[1200px] px-4 pb-20 md:px-6">
          <h2 id="features-heading" className="text-section max-w-[22ch]">
            Everything between your crate and the booth.
          </h2>
          <ul className="mt-10 grid gap-x-12 sm:grid-cols-2">
            {FEATURES.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4 border-t border-divider py-7">
                <Icon className="mt-1 size-5 shrink-0 text-action" aria-hidden />
                <div>
                  <h3 className="text-card-title">{title}</h3>
                  <p className="mt-2 max-w-[52ch] text-body">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="steps-heading" className="border-y border-divider bg-surface/50">
          <div className="mx-auto max-w-[1200px] px-4 py-16 md:px-6">
            <h2 id="steps-heading" className="sr-only">
              How it works
            </h2>
            {/* The steps are hot cue pads A to C, lit in alternating cue colours. */}
            <ol className="grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.n} className="flex gap-4">
                  <span
                    aria-hidden
                    className={`key-lit flex size-14 shrink-0 items-center justify-center rounded-[10px] font-mono text-[24px] font-bold ${i === 1 ? "[--led:var(--electric)]" : ""}`}
                  >
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-card-title">{s.title}</h3>
                    <p className="mt-1 text-body">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

      </main>

      <footer className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-12 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          {/* The header has no room for the theme switch on phones, so it lives here. */}
          <ThemeToggle className="sm:hidden" />
        </div>
        <p className="max-w-[70ch] text-caption text-muted">
          Plans are proposals to review and edit. Scores are transparent heuristics and do not judge musical quality. Track audio never leaves
          your machine; only the measurements and metadata you save are stored.
        </p>
      </footer>
    </>
  );
}
