import { KeyChip } from "@/components/music/key-chip";
import { WaveformArt } from "@/components/music/waveform-art";
import type { MusicalKey } from "@/lib/domain/camelot";

const DECKS: { deck: string; led?: string; title: string; artist: string; bpm: string; key: MusicalKey; seed: number; offset: number }[] = [
  { deck: "A", title: "Warm Room", artist: "Example Artist", bpm: "124.0", key: { tonic: 9, mode: "minor" }, seed: 1, offset: 0 },
  // Deck B's waveform sits half a bar along from A's, so the two screens read as different tracks.
  { deck: "B", led: "var(--electric)", title: "Late Signal", artist: "Second Artist", bpm: "125.0", key: { tonic: 4, mode: "minor" }, seed: 4, offset: -118 },
];

/** One beat of the 124 BPM bar, in seconds; the beat meters step on it. */
const BEAT = 0.4839;

/**
 * One deck's waveform: a strip of one-bar tiles (236px, the deck-scroll period) passing a fixed
 * playhead, with the beat grid on top and the downbeat in red, as on a CDJ screen.
 */
function ScrollingWaveform({ seed, offset }: { seed: number; offset: number }) {
  return (
    <div className="relative mt-3 h-14 overflow-hidden rounded-[6px]">
      <div className="deck-wave flex w-max" style={{ marginLeft: offset }}>
        {Array.from({ length: 4 }, (_, tile) => (
          <div key={tile} className="relative w-[236px] shrink-0">
            {[0, 1, 2, 3].map((beat) => (
              <span
                key={beat}
                className={beat === 0 ? "absolute top-0 h-2.5 w-0.5 bg-[var(--led-red)]" : "absolute top-0 h-1.5 w-px bg-on-dark/45"}
                style={{ left: `${beat * 25}%` }}
              />
            ))}
            <WaveformArt seed={seed} bars={22} className="h-14 px-px" />
          </div>
        ))}
      </div>
      {/* The part already played dims, and the playhead stays put while the track moves. */}
      <span className="absolute inset-y-0 left-0 w-[35%] bg-[color-mix(in_oklab,var(--screen)_55%,transparent)]" />
      <span className="absolute inset-y-0 left-[35%] w-0.5 bg-white shadow-[0_0_8px_rgb(255_255_255/0.7)]" />
    </div>
  );
}

/**
 * The landing page's example transition drawn as a two-deck CDJ screen: each deck with its
 * cue pad, track, key, tempo in seven-segment digits, a beat meter, and a scrolling waveform.
 * Both decks run at the same tempo, so their beat meters step together. Decorative; the
 * figcaption carries the content for assistive technology.
 */
export function TwoDeckScreen() {
  return (
    <figure className="on-dark relative animate-rise overflow-hidden rounded-card border border-on-dark/10 bg-dark p-4 text-on-dark shadow-lift [animation-delay:120ms] md:p-5">
      <div aria-hidden className="absolute inset-0 stage-glow" />
      <div aria-hidden className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-eyebrow whitespace-nowrap text-on-dark-muted">Example transition</span>
          <span className="rounded-full border border-action-on-dark/40 bg-action-on-dark/10 px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-action-on-dark">
            Long blend · 32 beats
          </span>
        </div>
        {/* The black edition: the screen sits in dark plate here, in either theme. */}
        <div className="deck-screen mt-4 flex flex-col divide-y divide-divider [--plate-edge:#2a2b30]">
          {DECKS.map((d) => (
            <div key={d.deck} className="p-3.5 md:p-4">
              <div className="flex items-center gap-3">
                <span
                  className="key-lit flex size-8 shrink-0 items-center justify-center rounded-[8px] font-mono text-[14px] font-bold"
                  style={d.led ? ({ "--led": d.led } as React.CSSProperties) : undefined}
                >
                  {d.deck}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{d.title}</p>
                  <p className="truncate text-caption text-muted">{d.artist}</p>
                </div>
                <KeyChip musicalKey={d.key} />
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-segment text-[16px] leading-none text-ink tabular">
                    {d.bpm}
                    <span className="ml-1 hidden font-sans text-[11px] text-muted sm:inline">BPM</span>
                  </span>
                  <span className="flex gap-[3px]">
                    {[0, 1, 2, 3].map((beat) => (
                      <span
                        key={beat}
                        className="deck-beat h-1.5 w-3.5 rounded-[1px]"
                        style={{ background: d.led ?? "var(--led-orange)", animationDelay: `${beat * BEAT}s` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
              <ScrollingWaveform seed={d.seed} offset={d.offset} />
            </div>
          ))}
        </div>
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
        An illustration of a planned transition between two example tracks: 8A to 9A, adjacent on the Camelot wheel, a 0.8% tempo change, and
        an energy step from 6 to 7.
      </figcaption>
    </figure>
  );
}
