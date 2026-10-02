import * as React from "react";
import { formatTime } from "@/lib/domain/format";
import type { CueRegion } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const PAD_COUNT = 8;
const LED: Record<CueRegion["kind"], string> = { entry: "var(--led-green)", exit: "var(--led-amber)" };

/**
 * The track's cue regions as a CDJ shows hot cues: an overview strip of the whole track with
 * each region in place, and a row of lit pads lettered from A in time order. Entry regions
 * light green and exit regions amber; regions still awaiting review stay unlit. Rejected
 * regions are left out, as they are everywhere else.
 */
export function CueDeck({ cues, duration }: { cues: CueRegion[]; duration: number }) {
  const regions = cues.filter((c) => c.reviewStatus !== "rejected").sort((a, b) => a.startSeconds - b.startSeconds);
  const pads = regions.slice(0, PAD_COUNT);
  const pct = (s: number) => `${duration > 0 ? Math.min(100, Math.max(0, (s / duration) * 100)) : 0}%`;
  const letter = (i: number) => String.fromCharCode(65 + i);

  return (
    <section aria-labelledby="cue-deck-heading" className="deck-screen m-1 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cue-deck-heading" className="inline-flex items-center gap-2 text-eyebrow text-muted">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--led-blue)] shadow-[0_0_6px_var(--led-blue)]" />
          Hot cues
        </h2>
        <p className="text-eyebrow text-muted">
          {regions.length} region{regions.length === 1 ? "" : "s"} ·{" "}
          <span className="font-segment text-[14px] tracking-normal text-ink">{formatTime(duration)}</span>
        </p>
      </div>

      {/* Overview strip: the whole track, ticked every tenth, with each region in place. */}
      <div
        aria-hidden
        className="relative mt-3 h-10 overflow-hidden rounded-[6px] bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.12)_0_1px,transparent_1px_10%)] shadow-[inset_0_1px_3px_rgb(0_0_0/0.8),0_0_0_1px_#2e2f35]"
      >
        {regions.map((c, i) => (
          <span
            key={c.id}
            className={cn("absolute inset-y-1 min-w-1.5 rounded-[3px] border", c.reviewStatus === "pending" && "border-dashed opacity-60")}
            style={{
              left: pct(c.startSeconds),
              width: `calc(${pct(c.endSeconds)} - ${pct(c.startSeconds)})`,
              borderColor: LED[c.kind],
              background: `color-mix(in oklab, ${LED[c.kind]} 28%, transparent)`,
            }}
          >
            {i < PAD_COUNT ? <span className="absolute top-0.5 left-1 font-mono text-[10px] font-bold text-ink">{letter(i)}</span> : null}
          </span>
        ))}
      </div>

      {pads.length ? (
        <ol className="mt-4 grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-8">
          {pads.map((c, i) => (
            <li key={c.id} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "flex size-11 items-center justify-center rounded-[10px] font-mono text-[17px] font-bold",
                  c.reviewStatus === "pending" ? "key key-black text-muted" : "key-lit",
                )}
                style={c.reviewStatus === "pending" ? undefined : ({ "--led": LED[c.kind] } as React.CSSProperties)}
              >
                {letter(i)}
              </span>
              <span aria-hidden className="flex flex-col items-center leading-none">
                <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted uppercase">{c.kind === "entry" ? "In" : "Out"}</span>
                <span className="mt-1 font-segment text-[13px] text-ink">{formatTime(c.startSeconds)}</span>
              </span>
              <span className="sr-only">
                {`Cue ${letter(i)}: ${c.kind} region from ${formatTime(c.startSeconds)} to ${formatTime(c.endSeconds)}, ${c.reviewStatus === "pending" ? "awaiting review" : "approved"}.`}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-caption text-muted">No cue regions yet. Draw them on the waveform below, or add them under Cue regions.</p>
      )}
      {regions.length > PAD_COUNT ? (
        <p className="mt-3 text-caption text-muted">
          {regions.length - PAD_COUNT} more region{regions.length - PAD_COUNT === 1 ? "" : "s"} after pad H; all of them are listed under Cue regions.
        </p>
      ) : null}
    </section>
  );
}
