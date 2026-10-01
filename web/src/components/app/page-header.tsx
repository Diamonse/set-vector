import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  lead,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 pb-8 md:flex-row md:items-end md:justify-between", className)}>
      <div className="max-w-[70ch]">
        {eyebrow ? <div className="mb-2 text-caption font-semibold tracking-wide text-muted uppercase">{eyebrow}</div> : null}
        <h1 className="text-section">{title}</h1>
        {lead ? <p className="mt-2 text-body">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
