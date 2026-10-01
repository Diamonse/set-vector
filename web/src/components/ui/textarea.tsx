import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full rounded-control border border-control-border bg-surface px-3 py-2 text-base transition-colors hover:border-muted text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action aria-invalid:border-error disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
