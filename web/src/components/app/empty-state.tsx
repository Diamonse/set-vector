import * as React from "react";
import { LogoMark } from "@/components/app/logo";
import { Platter } from "@/components/music/platter";

/**
 * An empty deck: the screen a CDJ shows with no track loaded. Blank readouts frame a jog
 * display, and the actions sit on the screen like the deck's own keys.
 */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="deck-screen m-1 px-6 pt-5 pb-10 text-center">
      <div aria-hidden className="flex items-center justify-between font-mono text-[12px] font-semibold tracking-[0.12em] text-muted uppercase">
        <span className="inline-flex items-center gap-2">
          <span className="rounded-[4px] bg-[var(--led-orange)] px-1.5 text-[var(--led-ink)]">1</span>
          No track loaded
        </span>
        <span className="deck-blink tabular"><span className="font-segment tracking-normal">---.-</span> BPM</span>
      </div>
      <Platter className="mx-auto mt-6 mb-6 size-28">
        <LogoMark animated className="h-6" />
      </Platter>
      <h2 className="text-card-title text-ink">{title}</h2>
      {children ? <div className="mx-auto mt-2 max-w-[60ch] text-body">{children}</div> : null}
      {action ? <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
