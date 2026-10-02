import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons are CDJ keys: a backlit orange pad for the main action (red for destructive),
 * rubber function keys for the rest, and round keys for icon buttons, like a CDJ's transport
 * and small round buttons. Materials follow the theme (white edition on light, black on dark).
 */
const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-ui no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:pointer-events-none disabled:opacity-60 disabled:saturate-[.3] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "key-lit",
        secondary: "key",
        ghost:
          "border border-transparent text-[var(--key-ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--key-face)_75%,transparent)] active:bg-[var(--key-well)]",
        destructive: "key-lit [--led:var(--led-red)]",
        link: "min-h-0 px-0 text-action underline underline-offset-2 hover:text-action-hover",
        dark: "key key-black focus-visible:outline-action-on-dark",
      },
      size: {
        default: "",
        sm: "min-h-9 px-3 text-[13px] pointer-coarse:min-h-11",
        icon: "size-11 rounded-full px-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  // An icon button is always a physical round key; a bare legend with no label would be unreadable.
  const resolved = variant === "ghost" && size === "icon" ? "secondary" : variant;
  return <Comp data-slot="button" className={cn(buttonVariants({ variant: resolved, size }), className)} {...props} />;
}

export { Button, buttonVariants };
