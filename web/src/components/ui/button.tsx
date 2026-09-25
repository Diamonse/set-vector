import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] px-4 text-ui no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-action text-white hover:bg-action-hover active:bg-action-hover",
        secondary: "border border-control-border bg-surface text-ink hover:bg-surface-subtle active:bg-surface-subtle",
        ghost: "text-ink hover:bg-surface-subtle",
        destructive: "bg-error text-white hover:bg-[#8f1b22]",
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
