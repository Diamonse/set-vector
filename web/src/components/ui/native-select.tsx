import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "min-h-11 w-full appearance-none rounded-[8px] border border-control-border bg-surface py-2 pr-10 pl-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action aria-invalid:border-error disabled:opacity-55",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export { NativeSelect };
