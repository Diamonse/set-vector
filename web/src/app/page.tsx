import { ArrowRight, AudioLines, Disc3, FileUp, Headphones, ListChecks, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { ArcWheel } from "@/components/landing/arc-wheel";
import { HowItWorks } from "@/components/landing/how-it-works";
import { TwoDeckScreen } from "@/components/landing/two-deck-screen";
import { IntroSplash } from "@/components/loading/intro-splash";
import { Button } from "@/components/ui/button";
import { AnnotatedText, type AnnotationVariant } from "@/components/ui/annotated-text";
import { KineticTextReveal } from "@/components/ui/kinetic-text-reveal";
import { TextMorph } from "@/components/ui/text-morph";
import { createClient } from "@/lib/supabase/server";

const FEATURES = [
  {
    Icon: AudioLines,
    title: "Analyze in the browser",
    body: "Tempo, beat grid, downbeats, key, loudness, and cue suggestions from your own files. Audio never leaves your device.",
    mark: { phrase: "never leaves your device", variant: "underline" as const },
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
    mark: { phrase: "never overwrites", variant: "circle" as const },
  },
];

/** Body copy with one phrase marked up in marker, like notes on a setlist. */
function Marked({ text, phrase, variant }: { text: string; phrase: string; variant: AnnotationVariant }) {
  const at = text.indexOf(phrase);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <AnnotatedText variant={variant} delay={0.2}>
        {phrase}
      </AnnotatedText>
      {text.slice(at + phrase.length)}
    </>
  );
}

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
            <Logo cascade />
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
            {/* Several reveals in one heading, so "set" can morph and "evidence" can take the action colour; the
                delays continue the stagger, one beat per word. */}
            <h1 className="mt-6 text-display max-w-[15ch]">
              <KineticTextReveal text="Shape a" delay={0.1} />{" "}
              <span className="-my-[0.12em] inline-block overflow-hidden py-[0.12em] align-bottom">
                <span className="kinetic-segment" style={{ "--kinetic-delay": "0.25s" } as React.CSSProperties}>
                  <TextMorph words={["set", "playlist", "warm-up"]} />
                </span>
              </span>
              {/* The line ends after the morphing word, so a longer word never pushes the rest onto a new line. */}
              <br />
              <KineticTextReveal text="from" delay={0.325} />{" "}
              <AnnotatedText variant="underline" delay={1.1}>
                <KineticTextReveal text="evidence" className="text-action" delay={0.4} />
              </AnnotatedText>{" "}
              <KineticTextReveal text="you can inspect." delay={0.475} />
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

          <TwoDeckScreen />
        </section>

        <section
          aria-labelledby="features-heading"
          className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-20 md:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"
        >
          <h2 id="features-heading" className="text-section max-w-[22ch] lg:sticky lg:top-24 lg:self-start">
            <KineticTextReveal text="Everything between your crate and the booth." trigger="inView" />
          </h2>
          {/* The features as the CDJ's browse screen: a title bar, then one row per item. */}
          <div className="deck-screen m-1 self-start">
            <div aria-hidden className="flex items-center justify-between border-b border-divider px-4 py-2.5 text-eyebrow text-muted">
              <span className="inline-flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[var(--led-blue)] shadow-[0_0_6px_var(--led-blue)]" />
                Browse · Features
              </span>
              <span className="font-segment text-[14px] tracking-normal text-ink">{FEATURES.length}</span>
            </div>
            <ul className="divide-y divide-divider">
              {FEATURES.map(({ Icon, title, body, mark }) => (
                <li key={title} className="flex gap-4 px-4 py-5 md:px-5">
                  <Icon className="mt-1 size-5 shrink-0 text-[var(--led-orange)] drop-shadow-[0_0_6px_var(--led-orange)]" aria-hidden />
                  <div>
                    <h3 className="text-card-title">{title}</h3>
                    <p className="mt-1.5 max-w-[60ch] text-body">{mark ? <Marked text={body} {...mark} /> : body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="arc-heading" className="mx-auto grid max-w-[1200px] gap-8 px-4 pb-20 md:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
          <div>
            <h2 id="arc-heading" className="text-section max-w-[16ch]">
              <KineticTextReveal text="Pick the shape of the night." trigger="inView" />
            </h2>
            <p className="mt-4 max-w-[48ch] text-body">
              The planner scores each order against an energy arc. Spin the wheel to see the shapes it starts from; you can draw your own too.
            </p>
          </div>
          <ArcWheel />
        </section>

        <HowItWorks />

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
      {/* The first-load intro plays only here; the head script (lib/intro.ts) checks the path. */}
      <IntroSplash />
    </>
  );
}
