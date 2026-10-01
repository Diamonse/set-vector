import * as React from "react";
import { LogoMark } from "@/components/app/logo";

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-dashed border-control-border/50 bg-surface/60 px-6 py-12 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(28rem_14rem_at_50%_0%,var(--glow-a),transparent_70%)]" />
      <div className="relative">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-card border border-divider bg-surface shadow-card">
          <LogoMark animated className="h-6" />
        </span>
        <h2 className="text-card-title">{title}</h2>
        {children ? <div className="mx-auto mt-2 max-w-[60ch] text-body">{children}</div> : null}
        {action ? <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div> : null}
      </div>
    </div>
  );
}
