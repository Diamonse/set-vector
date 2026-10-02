import { Badge } from "@/components/ui/badge";

export type EvidenceKind = "reviewed" | "estimated" | "pending" | "unavailable" | "uncertain" | "review" | "rejected" | "fallback";

const CONFIG: Record<EvidenceKind, { label: string; tone: "neutral" | "success" | "warning" | "error" | "action" }> = {
  reviewed: { label: "Reviewed", tone: "success" },
  estimated: { label: "Estimated", tone: "neutral" },
  pending: { label: "Pending review", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "neutral" },
  uncertain: { label: "Uncertain", tone: "warning" },
  review: { label: "Review needed", tone: "warning" },
  rejected: { label: "Rejected", tone: "error" },
  fallback: { label: "No cue", tone: "warning" },
};

/** Status as an indicator LED with its legend. The text always names the state. */
export function StatusBadge({ kind, label }: { kind: EvidenceKind; label?: string }) {
  const { label: defaultLabel, tone } = CONFIG[kind];
  return (
    <Badge tone={tone} led={tone === "neutral" ? "unlit" : "auto"}>
      {label ?? defaultLabel}
    </Badge>
  );
}
