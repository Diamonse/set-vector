import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type EvidenceKind = "reviewed" | "estimated" | "pending" | "unavailable" | "uncertain" | "review" | "rejected" | "fallback";

const CONFIG: Record<EvidenceKind, { label: string; tone: "neutral" | "success" | "warning" | "error" | "action"; Icon: typeof CheckCircle2 }> = {
  reviewed: { label: "Reviewed", tone: "success", Icon: CheckCircle2 },
  estimated: { label: "Estimated", tone: "neutral", Icon: CircleDashed },
  pending: { label: "Pending review", tone: "warning", Icon: CircleDashed },
  unavailable: { label: "Unavailable", tone: "neutral", Icon: HelpCircle },
  uncertain: { label: "Uncertain", tone: "warning", Icon: HelpCircle },
  review: { label: "Review needed", tone: "warning", Icon: AlertTriangle },
  rejected: { label: "Rejected", tone: "error", Icon: XCircle },
  fallback: { label: "No cue", tone: "warning", Icon: AlertTriangle },
};

/** Text-labelled status pill. Color is never the only signal. */
export function StatusBadge({ kind, label }: { kind: EvidenceKind; label?: string }) {
  const { label: defaultLabel, tone, Icon } = CONFIG[kind];
  return (
    <Badge tone={tone}>
      <Icon className="size-3.5" aria-hidden />
      {label ?? defaultLabel}
    </Badge>
  );
}
