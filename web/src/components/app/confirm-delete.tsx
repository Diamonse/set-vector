"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ConfirmDelete({
  title,
  description,
  onConfirm,
  triggerLabel = "Delete",
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  triggerLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Trash2 aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={() => startTransition(async () => void (await onConfirm()))}
          >
            {pending ? "Deleting" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
