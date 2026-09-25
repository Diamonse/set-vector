import * as React from "react";

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-control-border/60 bg-surface p-8 text-center">
      <h2 className="text-card-title">{title}</h2>
      {children ? <div className="mx-auto mt-2 max-w-[60ch] text-body">{children}</div> : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
