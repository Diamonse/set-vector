import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A small recessed display tag. Tones light an indicator LED beside the legend, like a CDJ's
 * status lights; the legend always states the meaning, so the LED is never the only signal.
 * Neutral tags have no LED unless `led` asks for an unlit one.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[6px] border border-divider bg-[var(--field)] px-2 py-0.5 text-[13px] leading-5 font-semibold whitespace-nowrap text-ink shadow-[inset_0_1px_2px_var(--key-shade)] before:size-2 before:shrink-0 before:rounded-full before:content-['']",
  {
    variants: {
      tone: {
        neutral: "before:hidden",
        success: "before:bg-[var(--led-green)] before:shadow-[0_0_6px_var(--led-green)]",
        warning: "before:bg-[var(--led-amber)] before:shadow-[0_0_6px_var(--led-amber)]",
        error: "before:bg-[var(--led-red)] before:shadow-[0_0_6px_var(--led-red)]",
        action: "before:bg-[var(--led-orange)] before:shadow-[0_0_6px_var(--led-orange)]",
      },
      led: {
        // An unlit LED: a dark lens with a rim, for states such as "estimated" or "unavailable".
        unlit: "before:block before:border before:border-[var(--key-edge)] before:bg-[var(--key-well)]",
        auto: "",
      },
    },
    defaultVariants: { tone: "neutral", led: "auto" },
  },
);

function Badge({ className, tone, led, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, led }), className)} {...props} />;
}

export { Badge, badgeVariants };
