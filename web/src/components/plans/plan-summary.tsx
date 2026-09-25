import { MetricCard } from "@/components/app/metric-card";
import { StatusBadge } from "@/components/app/status-badge";
import { formatPercent, formatTime } from "@/lib/domain/format";
import type { PlanMode } from "@/lib/domain/types";
import type { EvaluatedPlan } from "@/lib/planner";

export function PlanSummary({ plan, mode }: { plan: EvaluatedPlan; mode: PlanMode }) {
  const m = plan.metrics;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        label={mode === "dj" ? "Planned playback" : "Total length"}
        value={formatTime(m.totalSeconds)}
        detail={`${m.trackCount} tracks${mode === "dj" ? "; played spans and overlaps, not full lengths" : "; whole tracks"}${
          m.durationErrorSeconds ? `; ${formatTime(m.durationErrorSeconds)} outside target` : ""
        }`}
      />
      <MetricCard
        label="Transition cost"
        value={m.transitionCost.mean.toFixed(2)}
        unit="mean"
        detail={`Median ${m.transitionCost.median.toFixed(2)}, worst ${m.transitionCost.worst.toFixed(2)}${
          m.transitionCost.worstIndex !== null ? ` (transition ${m.transitionCost.worstIndex + 1})` : ""
        }. 0 means no concerns, 1 the most.`}
      />
      <MetricCard
        label="Transitions needing review"
        value={formatPercent(m.reviewNeededShare, 0)}
        status={m.reviewNeededShare > 0 ? <StatusBadge kind="review" /> : <StatusBadge kind="reviewed" label="None flagged" />}
        detail="Unverified cues, missing keys or tempo, or vocal overlap."
      />
      <MetricCard
        label="Arc deviation"
        value={m.arc.available ? (m.arc.rmse === null ? null : m.arc.rmse.toFixed(2)) : "No arc"}
        unit={m.arc.available && m.arc.rmse !== null ? "energy points RMS" : undefined}
        detail={
          m.arc.available
            ? `${formatPercent(m.arc.coverage, 0)} of playback time has an energy annotation.`
            : "No target arc was requested."
        }
      />
      <MetricCard
        label="Constraint issues"
        value={plan.violations.length}
        status={plan.violations.length ? <StatusBadge kind="review" label="Unsatisfied" /> : <StatusBadge kind="reviewed" label="All satisfied" />}
        detail="Required, excluded, anchors, repeats, cue spans, and duration."
      />
      <MetricCard
        label="Spacing and variety"
        value={m.diversity.artistViolations + m.diversity.remixViolations}
        unit="spacing conflicts"
        detail={`${m.diversity.styleCoverage.length} styles; longest run of one primary style: ${m.diversity.longestStyleRun}.`}
      />
    </div>
  );
}
