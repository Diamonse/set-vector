import * as React from "react";

/**
 * A CDJ-style error screen: an error code and message on the deck display, with a red LED,
 * the way a player reports a disc or file it cannot read. Actions sit below as keys.
 */
export function DeckError({
  code,
  title,
  children,
  action,
}: {
  code: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="deck-screen m-1 px-6 pt-5 pb-10 text-center">
      <div className="flex items-center justify-between font-mono text-[12px] font-semibold tracking-[0.12em] text-muted uppercase">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-[var(--led-red)] shadow-[0_0_8px_var(--led-red)]" />
          Error
        </span>
        <span aria-hidden className="deck-blink">
          <span className="font-segment tracking-normal">---.-</span> BPM
        </span>
      </div>
      <p className="mt-8 font-segment text-[44px] leading-none text-[var(--led-red)] [text-shadow:0_0_18px_rgb(255_90_80/0.45)]">
        {code}
      </p>
      <h1 className="mt-5 text-section text-ink">{title}</h1>
      {children ? <div className="mx-auto mt-3 max-w-[56ch] text-body">{children}</div> : null}
      {action ? <div className="mt-8 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
