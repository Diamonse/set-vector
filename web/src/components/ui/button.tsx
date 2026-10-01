import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-control px-4 text-ui no-underline transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-action text-on-action shadow-[0_6px_20px_-8px_var(--action)] hover:bg-action-hover hover:text-on-action hover:shadow-[0_8px_28px_-8px_var(--action)]",
        secondary: "border border-control-border/70 bg-surface text-ink hover:border-control-border hover:bg-surface-subtle hover:text-ink",
        ghost: "text-ink hover:bg-surface-subtle hover:text-ink",
        destructive: "bg-error text-on-error hover:bg-error/85 hover:text-on-error",
        link: "min-h-0 px-0 text-action underline underline-offset-2 hover:text-action-hover",
        dark: "border border-on-dark-muted/40 bg-dark-elevated text-on-dark hover:bg-dark focus-visible:outline-action-on-dark",
      },
      size: {
        default: "",
        sm: "min-h-9 px-3 text-[13px]",
        icon: "size-11 px-0",
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
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
