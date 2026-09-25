import { Badge } from "@/components/ui/badge";
import { formatTime } from "@/lib/domain/format";
import type { Annotation } from "@/lib/domain/types";

function summarize(a: Annotation): string {
  const p = a.payload;
  if (a.task === "track_metadata") {
    if (p.reason === "created") return "Track created";
    const changes = (p.changes ?? {}) as Record<string, unknown>;
    return `Changed ${Object.keys(changes).map((k) => k.replace(/_/g, " ")).join(", ")}`;
  }
  if (a.level === "region") {
    const region = a.regionStartSeconds !== null && a.regionEndSeconds !== null ? ` ${formatTime(a.regionStartSeconds)} to ${formatTime(a.regionEndSeconds)}` : "";
    return `${a.task.replace("_", " ")} ${String(p.action ?? "")}${region}${p.review_status ? `, ${String(p.review_status)}` : ""}`;
  }
  if (a.task === "transition_judgment") return `Transition judged: ${String(p.judgment ?? "").replace("_", " ")}`;
  return a.task.replace(/_/g, " ");
}

export function AnnotationList({ annotations }: { annotations: Annotation[] }) {
  if (annotations.length === 0) return <p className="text-muted">No revisions recorded yet.</p>;
  return (
    <ol className="flex flex-col divide-y divide-divider">
      {annotations.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-ink">{summarize(a)}</p>
            {a.note ? <p className="text-caption text-muted">Reason: {a.note}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge>{a.isEstimate ? "Estimate" : "Human decision"}</Badge>
            <span className="text-caption text-muted">
              Rev. {a.revision} · <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time>
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
