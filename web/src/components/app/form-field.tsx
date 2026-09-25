import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Label, control, and helper or error text. The control receives id,
 * aria-describedby, and aria-invalid so errors are announced, not just colored.
 */
export function FormField({
  id,
  label,
  helper,
  error,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  helper?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const control = React.cloneElement(children, {
    id,
    "aria-describedby": [helperId, errorId].filter(Boolean).join(" ") || undefined,
    "aria-invalid": error ? true : undefined,
  });
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {helper ? (
        <p id={helperId} className="text-caption text-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-caption font-semibold text-error">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}
