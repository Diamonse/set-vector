"use client";

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-dark/60 backdrop-blur-sm" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "deck-screen fixed top-1/2 left-1/2 z-50 w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 p-6",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-action"
          aria-label="Close"
        >
          <XIcon className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title
      className={cn(
        "flex items-center gap-2.5 pr-10 text-card-title text-ink before:size-2 before:shrink-0 before:rounded-full before:bg-[var(--led-amber)] before:shadow-[0_0_8px_var(--led-amber)] before:content-['']",
        className,
      )}
      {...props}
    />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-2 text-body", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-6 flex flex-wrap justify-end gap-3", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger };
