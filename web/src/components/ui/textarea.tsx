import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "field min-h-24 w-full rounded-control px-3 py-2 text-base placeholder:text-muted focus-visible:outline-none aria-invalid:border-error disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
