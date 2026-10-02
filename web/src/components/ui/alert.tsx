import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Messages appear as a pop-up on the deck screen: always dark, with an indicator LED for the
 * tone. The message text carries the meaning; the LED repeats it.
 */
const alertVariants = cva(
  "deck-screen m-1 flex items-start gap-3 p-4 text-[15px] text-ink before:mt-1.5 before:size-2 before:shrink-0 before:rounded-full before:content-['']",
  {
    variants: {
      tone: {
        neutral: "before:border before:border-[var(--key-edge)] before:bg-transparent",
        warning: "before:bg-[var(--led-amber)] before:shadow-[0_0_8px_var(--led-amber)]",
        error: "before:bg-[var(--led-red)] before:shadow-[0_0_8px_var(--led-red)]",
        success: "before:bg-[var(--led-green)] before:shadow-[0_0_8px_var(--led-green)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Alert({ className, tone, children, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div data-slot="alert" role={tone === "error" ? "alert" : "status"} className={cn(alertVariants({ tone }), className)} {...props}>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-ui text-ink", className)} {...props} />;
}

export { Alert, AlertTitle };
