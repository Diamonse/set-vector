import * as React from "react";
import { KineticTextReveal } from "@/components/ui/kinetic-text-reveal";
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
    <header className={cn("flex animate-rise flex-col gap-5 pb-10 md:flex-row md:items-end md:justify-between", className)}>
      <div className="max-w-[72ch]">
        {eyebrow ? (
          <div className="mb-3 inline-flex items-center gap-2 text-eyebrow text-muted [&_a]:text-muted [&_a:hover]:text-ink">
            <span aria-hidden className="size-1.5 rounded-full bg-action" />
            {eyebrow}
          </div>
        ) : null}
        {/* Plain-text titles rise in word by word; composed titles render as given. */}
        <h1 className="text-section">{typeof title === "string" ? <KineticTextReveal text={title} delay={0.08} /> : title}</h1>
        {lead ? <div className="mt-3 text-body">{lead}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}
