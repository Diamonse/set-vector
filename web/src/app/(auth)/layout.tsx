import { Check } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { WaveformArt } from "@/components/music/waveform-art";

const POINTS = [
  "Analyze audio in your browser; files never leave your device",
  "Import your Rekordbox collection with its beat grids",
  "Plan DJ sets or listening flows with every transition explained",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="on-dark relative hidden overflow-hidden bg-dark p-12 text-on-dark lg:flex lg:flex-col">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(40rem_26rem_at_0%_0%,rgb(255_138_61/0.22),transparent_70%),radial-gradient(36rem_24rem_at_100%_100%,rgb(111_178_255/0.18),transparent_70%)]" />
        <Link href="/" className="relative no-underline [&_span]:text-on-dark">
          <Logo />
        </Link>
        <div className="relative mt-auto">
          <p className="text-eyebrow text-action-on-dark">Set planning for DJs</p>
          <p className="mt-4 max-w-[16ch] font-[family-name:var(--font-display)] text-[44px] leading-[1.02] font-semibold tracking-[-0.04em] text-on-dark">
            Every transition, explained.
          </p>
          <WaveformArt animated bars={64} className="mt-10 h-28" />
          <ul className="mt-10 flex flex-col gap-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-on-dark-muted">
                <Check className="mt-1 size-4 shrink-0 text-action-on-dark" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <main id="main" className="relative flex flex-col px-4 py-6 md:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="no-underline lg:invisible">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 animate-rise flex-col justify-center py-12">{children}</div>
      </main>
    </div>
  );
}
