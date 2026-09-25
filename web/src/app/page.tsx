import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main id="main">
      <section className="mx-auto max-w-[1200px] px-4 pt-16 pb-16 md:px-6 md:pt-24">
        <p className="text-caption font-semibold tracking-wide text-muted uppercase">SetVector</p>
        <h1 className="text-display mt-3 max-w-[20ch] text-ink">Shape a set from evidence you can inspect.</h1>
        <p className="text-lead mt-6 max-w-[60ch] text-body">
          Keep reviewed keys, tempos, cue regions, and energy notes for your library. Plan a DJ set or a listening
          playlist, see why each transition was suggested, and change anything the planner got wrong.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {user ? (
            <Button asChild>
              <Link href="/library">Open your library</Link>
            </Button>
          ) : (
            <>
              <Button asChild>
                <Link href="/signup">Create an account</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/login">Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="bg-surface-subtle">
        <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-16 md:grid-cols-3 md:px-6">
          {[
            {
              title: "Reviewed library",
              body: "Enter or import track metadata. Estimates and your corrections stay separate, and every change is kept as a revision.",
            },
            {
              title: "Two planning modes",
              body: "DJ preparation plans cue regions, overlaps, and tempo changes. Listening flow orders whole tracks for pacing and variety.",
            },
            {
              title: "Explained suggestions",
              body: "Each transition lists its key relation, tempo change, cue status, and energy step. Missing evidence is shown, not hidden.",
            },
          ].map((card) => (
            <div key={card.title} className="rounded-[12px] border border-divider bg-surface p-6">
              <h2 className="text-card-title">{card.title}</h2>
              <p className="mt-2">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-16 md:px-6">
        <p className="max-w-[70ch] text-body">
          Plans are proposals to review and edit. Scores are transparent heuristics and do not judge musical quality.
          Track audio never leaves your machine; this app stores only the metadata you enter or import.
        </p>
      </section>
    </main>
  );
}
