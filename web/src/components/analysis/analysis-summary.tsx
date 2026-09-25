import Link from "next/link";
import { MetricCard } from "@/components/app/metric-card";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StoredAnalysis } from "@/lib/data/queries";
import { formatTime } from "@/lib/domain/format";
import { keyLabel, lufs, tempoSourceLabel } from "./format";

/** The latest browser analysis of a track, shown as separate measurements with their limits. */
export function AnalysisSummary({ analysis, trackTitle }: { analysis: StoredAnalysis | null; trackTitle: string }) {
  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No audio analysis yet</CardTitle>
          <CardDescription>
            Analyze your copy of {trackTitle} to get tempo, a beat grid, key, loudness, and suggested cue regions. The file stays on your device.
          </CardDescription>
        </CardHeader>
        <Link href="/library/analyze">Analyze audio</Link>
      </Card>
    );
  }
  const r = analysis.result;
  return (
    <section aria-labelledby="analysis-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="analysis-heading" className="text-card-title">
          Latest audio analysis
        </h2>
        <p className="text-caption text-muted">
          {r.extractor.name} v{r.extractor.version}
          {r.extractor.model ? ` with ${r.extractor.model.name}` : ", fallback beat tracker"} ·{" "}
          <time dateTime={analysis.createdAt}>{new Date(analysis.createdAt).toLocaleString()}</time>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Tempo"
          value={r.tempo.bpm === null ? null : r.tempo.bpm.toFixed(2)}
          unit="BPM"
          status={<StatusBadge kind="estimated" />}
          detail={`${tempoSourceLabel(r.tempo.source)}${r.tempo.alternatives.length ? `; alternatives ${r.tempo.alternatives.map((b) => b.toFixed(0)).join(", ")}` : ""}`}
        />
        <MetricCard
          label="Beat grid"
          value={r.rhythm.chosen ? `${r.rhythm.beats.length} beats` : null}
          status={r.rhythm.chosen ? <StatusBadge kind="estimated" label="Reliable" /> : <StatusBadge kind="review" label="Not reliable" />}
          detail={
            r.rhythm.chosen
              ? `${r.rhythm.downbeats.length ? `${r.rhythm.downbeats.length} bars from model downbeats` : "No downbeats (fallback tracker)"}; ${r.rhythm.segments.length} tempo segment(s)`
              : r.rhythm.reasons[0] ?? "No grid"
          }
        />
        <MetricCard
          label="Key"
          value={r.key.tonic === null ? null : keyLabel(r.key)}
          status={<StatusBadge kind={r.key.status === "estimated" ? "estimated" : "uncertain"} />}
          detail={`Template correlation ${r.key.correlation.toFixed(2)}, margin ${r.key.margin.toFixed(2)} (a diagnostic, not a probability)`}
        />
        <MetricCard
          label="Integrated loudness"
          value={r.loudness.integratedLufs === null ? null : lufs(r.loudness.integratedLufs)}
          detail={`BS.1770-4; loudness range ${r.loudness.loudnessRangeLu === null ? "n/a" : `${r.loudness.loudnessRangeLu.toFixed(1)} LU`}; not an energy score`}
        />
      </div>
      {r.regionKeys.length ? (
        <p className="text-caption text-muted">
          Keys in suggested regions:{" "}
          {r.regionKeys.map((k) => `${k.kind} ${formatTime(k.startSeconds)} to ${formatTime(k.endSeconds)}: ${keyLabel(k.key)}${k.key.status === "uncertain" ? " (uncertain)" : ""}`).join("; ")}
          .
        </p>
      ) : null}
      {r.warnings.length ? (
        <details className="text-caption text-muted">
          <summary className="min-h-11 cursor-pointer py-2 text-ui text-action">Analysis notes ({r.warnings.length})</summary>
          <ul className="list-disc pl-5">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
