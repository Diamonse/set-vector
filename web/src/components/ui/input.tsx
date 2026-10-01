import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-11 w-full rounded-control border border-control-border/70 bg-surface px-3 transition-colors hover:border-control-border py-2 text-base text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-55 aria-invalid:border-error file:mr-3 file:border-0 file:bg-transparent file:text-ui file:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
