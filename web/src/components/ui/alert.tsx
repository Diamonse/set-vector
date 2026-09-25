import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-[12px] border p-4 text-[15px]", {
  variants: {
    tone: {
      neutral: "border-divider bg-surface-subtle text-body",
      warning: "border-warning/40 bg-warning/8 text-ink",
      error: "border-error/40 bg-error/8 text-ink",
      success: "border-success/40 bg-success/8 text-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

function Alert({ className, tone, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role={tone === "error" ? "alert" : "status"} className={cn(alertVariants({ tone }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-ui text-ink", className)} {...props} />;
}

export { Alert, AlertTitle };
