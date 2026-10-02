"use client";

import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/** A small rubber toggle key, like a CDJ's SYNC or KEY LOCK: pressed in with a lit check when on. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "key peer size-5 shrink-0 rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:opacity-55",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3.5 text-action drop-shadow-[0_0_3px_var(--led-orange)]" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
