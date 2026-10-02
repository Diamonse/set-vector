import { StatusBadge } from "@/components/app/status-badge";
import { EnergyMeter } from "@/components/music/energy-meter";
import { KeyChip } from "@/components/music/key-chip";
import { WaveformArt } from "@/components/music/waveform-art";
import { KineticTextReveal } from "@/components/ui/kinetic-text-reveal";
import { StickyScrollCards, type StickyScrollCardItem } from "@/components/ui/sticky-scroll-cards";
import type { MusicalKey } from "@/lib/domain/camelot";

const A_MINOR: MusicalKey = { tonic: 9, mode: "minor" };
const E_MINOR: MusicalKey = { tonic: 4, mode: "minor" };
const B_MINOR: MusicalKey = { tonic: 11, mode: "minor" };

/** One step: a lit hot-cue pad with its letter, the step's text, and a deck-screen illustration. */
function StepCard({ pad, led, title, body, children }: { pad: string; led?: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <article className="p-6 md:p-8">
      <div className="flex gap-4">
        <span
          aria-hidden
          className="key-lit flex size-14 shrink-0 items-center justify-center rounded-[10px] font-mono text-[24px] font-bold"
          style={led ? ({ "--led": led } as React.CSSProperties) : undefined}
        >
          {pad}
        </span>
        <div>
          <p className="text-eyebrow text-muted">Step {pad}</p>
          <h3 className="mt-1 text-card-title">{title}</h3>
          <p className="mt-1 text-body">{body}</p>
        </div>
      </div>
      {/* The screens illustrate the step; the text above carries its meaning. */}
      <div aria-hidden className="deck-screen mt-6 p-4">
        {children}
      </div>
    </article>
  );
}

const CARDS: StickyScrollCardItem[] = [
  {
    id: "analyze",
    content: (
      <StepCard pad="A" title="Analyze or import" body="Drop audio files or a Rekordbox export. Tempo, beat grid, key, loudness, and cue suggestions are measured in your browser.">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">Warm Room</p>
          <KeyChip musicalKey={A_MINOR} estimated />
          <span className="font-segment text-[14px] text-ink tabular">124.0</span>
        </div>
        <WaveformArt seed={2} bars={64} className="mt-3 h-16" />
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Downbeats", "32 bars"],
            ["Loudness", "−8.1 LUFS"],
            ["Cues", "3 + 3"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[8px] border border-divider px-2 py-2">
              <dt className="text-eyebrow text-muted">{k}</dt>
              <dd className="mt-1 font-mono text-[13px] font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </StepCard>
    ),
  },
  {
    id: "review",
    content: (
      <StepCard
        pad="B"
        led="var(--electric)"
        title="Review the evidence"
        body="Confirm keys, tempos, and cue regions on the waveform. Reviewed values are kept apart from estimates and never overwritten."
      >
        <div className="relative">
          <WaveformArt seed={5} bars={64} className="h-16" />
          {/* Entry and exit cue regions, drawn as on the waveform editor. */}
          <span className="absolute inset-y-0 left-[6%] w-[22%] rounded-[4px] border border-success/70 bg-success/15">
            <span className="absolute top-1 left-1.5 font-mono text-[10px] font-bold text-success">IN</span>
          </span>
          <span className="absolute inset-y-0 right-[8%] w-[24%] rounded-[4px] border border-warning/70 bg-warning/15">
            <span className="absolute top-1 right-1.5 font-mono text-[10px] font-bold text-warning">OUT</span>
          </span>
        </div>
        <ul className="mt-4 flex flex-col divide-y divide-divider">
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="text-caption text-muted">Key</span>
            <span className="flex items-center gap-3">
              <KeyChip musicalKey={A_MINOR} />
              <StatusBadge kind="reviewed" />
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="text-caption text-muted">Tempo</span>
            <span className="flex items-center gap-3">
              <span className="font-segment text-[14px] text-ink tabular">124.0</span>
              <StatusBadge kind="estimated" />
            </span>
          </li>
        </ul>
      </StepCard>
    ),
  },
  {
    id: "plan",
    content: (
      <StepCard pad="C" title="Plan and export" body="Generate an order, see why each transition was chosen, edit it, and export CSV or JSON.">
        <ol className="flex flex-col divide-y divide-divider">
          {[
            { title: "Warm Room", key: A_MINOR, bpm: "124.0", energy: 5 },
            { title: "Late Signal", key: E_MINOR, bpm: "125.0", energy: 7 },
            { title: "Night Shift", key: B_MINOR, bpm: "126.0", energy: 8 },
          ].map((t, i) => (
            <li key={t.title} className="flex items-center gap-3 py-2">
              <span className="w-5 font-mono text-[13px] text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{t.title}</span>
              <KeyChip musicalKey={t.key} />
              <span className="hidden font-segment text-[14px] text-ink tabular sm:inline">{t.bpm}</span>
              <EnergyMeter value={t.energy} className="text-[13px] text-ink" />
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t border-divider pt-3 text-eyebrow text-action">Export · CSV · JSON</p>
      </StepCard>
    ),
  },
];

/** Landing page section: the three steps stacked as sticky cards. */
export function HowItWorks() {
  return (
    <section aria-labelledby="steps-heading" className="border-y border-divider bg-surface/50 pt-16">
      <div className="mx-auto max-w-[1200px] px-4 md:px-6">
        <h2 id="steps-heading" className="text-section max-w-[22ch]">
          <KineticTextReveal text="How it works." trigger="inView" />
        </h2>
      </div>
      <StickyScrollCards cards={CARDS} hint="Scroll" className="mt-4" />
    </section>
  );
}
