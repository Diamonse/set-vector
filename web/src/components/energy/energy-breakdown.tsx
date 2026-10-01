import Link from "next/link";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { INPUTS, type EnergyEstimate } from "@/lib/energy/score";

function formatValue(value: number, unit: string): string {
  if (unit === "share") return `${Math.round(value * 100)}% of power below 250 Hz`;
  if (unit === "Hz") return `${Math.round(value)} Hz`;
  if (unit === "LUFS") return `${value.toFixed(1)} LUFS`;
  if (unit === "BPM") return `${value.toFixed(1)} BPM`;
  return `${value.toFixed(2)} ${unit}`;
}

/** How the automatic energy estimate for one track was formed. */
export function EnergyBreakdown({
  estimate,
  userEnergy,
  needsReanalysis,
}: {
  estimate: EnergyEstimate | null;
  /** The user's own rating, when it overrides the estimate. */
  userEnergy: number | null;
  needsReanalysis: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Energy estimate</CardTitle>
          {estimate?.energy !== null && estimate?.energy !== undefined ? (
            <span className="inline-flex items-center gap-3">
              <span className="font-mono text-[28px] leading-none font-semibold text-ink tabular">{estimate.energy.toFixed(1)}</span>
              <span className="text-caption text-muted">of 10</span>
              <StatusBadge kind="estimated" />
            </span>
          ) : null}
        </div>
        <CardDescription>
          Ranked against the {estimate?.population ?? 0} analyzed track(s) in your library, so it moves as the library changes. Experimental: the
          weights are a starting hypothesis, not a calibrated measurement.
        </CardDescription>
      </CardHeader>

      {userEnergy !== null ? (
        <p className="mb-4 rounded-[10px] border border-divider bg-surface-subtle px-3 py-2 text-caption text-body">
          Your rating of <span className="font-mono">{userEnergy}</span> is used for planning. Clear the energy field in Edit details to use the
          estimate instead.
        </p>
      ) : null}

      {!estimate || estimate.energy === null ? (
        <p className="text-body">
          {estimate?.reason ?? "No estimate yet."}{" "}
          <Link href="/library/analyze">Analyze audio</Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {estimate.contributions.map((c) => (
            <li key={c.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-ui text-ink">{c.label}</span>
                <span className="text-caption text-muted">
                  {formatValue(c.value, c.unit)} · {c.description} · weight {Math.round(c.weight * 100)}%
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                  <span className="block h-full rounded-full bg-action" style={{ width: `${Math.max(2, c.position * 100)}%` }} />
                </span>
                <span className="w-16 text-right font-mono text-[13px] text-body tabular">+{c.points.toFixed(1)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {estimate && estimate.missing.length ? (
        <p className="mt-4 text-caption text-muted">
          Not included: {estimate.missing.map((k) => INPUTS[k].label.toLowerCase()).join(", ")}.
          {needsReanalysis ? " This track was analyzed before drum activity was measured; analyze the file again to include it." : ""}
        </p>
      ) : null}
      <p className="mt-2 text-caption text-muted">The score is 1 plus the points above; each bar shows where the track sits for that input.</p>
    </Card>
  );
}
