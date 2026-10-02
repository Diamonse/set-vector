import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field min-h-11 w-full rounded-control px-3 py-2 text-base placeholder:text-muted focus-visible:outline-none disabled:opacity-55 aria-invalid:border-error file:mr-3 file:border-0 file:bg-transparent file:text-ui file:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
