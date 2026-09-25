"use client";

import { ArrowDown, ArrowUp, Download, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { adoptAlternative, saveEditedOrder } from "@/app/actions/plans";
import { FormMessage } from "@/components/app/form-message";
import { StatusBadge, type EvidenceKind } from "@/components/app/status-badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPercent, formatTime } from "@/lib/domain/format";
import {
  ARC_PRESET_LABELS,
  arcPoints,
  evaluateEditedOrder,
  type EvaluatedPlan,
  type OptionOrigin,
  type PlannerTrack,
  type PlanRequest,
  type PlanResult,
} from "@/lib/planner";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";
import { EnergyArcChart, type ArcChartItem } from "./energy-arc-chart";
import { PlanSummary } from "./plan-summary";
import { TransitionCard } from "./transition-card";

const ORIGIN_BADGE: Record<OptionOrigin, EvidenceKind | null> = {
  reviewed: "reviewed",
  estimated: "estimated",
  pending: "pending",
  fallback: "fallback",
  full_track: null,
};

function chartItems(plan: EvaluatedPlan): ArcChartItem[] {
  return plan.items.map((it, i) => {
    const next = plan.items[i + 1];
    const span = next ? next.elapsedStartSeconds - it.elapsedStartSeconds : plan.metrics.totalSeconds - it.elapsedStartSeconds;
    return { label: it.title, startSeconds: it.elapsedStartSeconds, spanSeconds: span, energy: it.energy, targetEnergy: it.targetEnergy };
  });
}

function SetOrder({
  plan,
  planId,
  editing,
  onMove,
  onRemove,
  judgments,
}: {
  plan: EvaluatedPlan;
  planId: string;
  editing: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  judgments: Record<string, string>;
}) {
  const worst = plan.metrics.transitionCost.worstIndex;
  const dj = plan.transitions[0]?.type !== "sequential";
  return (
    <ol className="flex flex-col" aria-label="Set order">
      {plan.items.map((item, i) => {
        const transition = plan.transitions[i];
        const entryBadge = ORIGIN_BADGE[item.entryOrigin];
        const exitBadge = ORIGIN_BADGE[item.exitOrigin];
        return (
          <li key={`${item.occurrenceId}-${i}`}>
            <div className="flex flex-col gap-3 rounded-[12px] border border-divider bg-surface p-4 md:flex-row md:items-center">
              <div className="flex items-center gap-4 md:w-[45%]">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-data font-semibold text-ink">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.title}</p>
                  <p className="truncate text-caption text-muted">{item.artist || "Unknown artist"}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1 text-[14px]">
                <p>
                  <span className="text-muted">Starts at </span>
                  <span className="text-data">{formatTime(item.elapsedStartSeconds)}</span>
                  {dj ? (
                    <>
                      <span className="text-muted"> · plays </span>
                      <span className="text-data">
                        {formatTime(item.playStartSeconds)} to {formatTime(item.playEndSeconds)}
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted"> · energy </span>
                  <span className="text-data">{item.energy ?? "n/a"}</span>
                  {item.targetEnergy !== null ? (
                    <>
                      <span className="text-muted"> (target </span>
                      <span className="text-data">{item.targetEnergy.toFixed(1)}</span>
                      <span className="text-muted">)</span>
                    </>
                  ) : null}
                </p>
                {dj ? (
                  <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
                    <span>In: {item.entryLabel}</span>
                    {entryBadge ? <StatusBadge kind={entryBadge} /> : null}
                    <span>Out: {item.exitLabel}</span>
                    {exitBadge ? <StatusBadge kind={exitBadge} /> : null}
                  </p>
                ) : null}
              </div>
              {editing ? (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Move ${item.title} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${item.title} down`}
                    disabled={i === plan.items.length - 1}
                    onClick={() => onMove(i, i + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${item.title}`} disabled={plan.items.length <= 1} onClick={() => onRemove(i)}>
                    <X aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
            {transition ? (
              <TransitionCard
                index={i}
                transition={transition}
                worst={worst === i && plan.transitions.length > 1}
                planId={planId}
                judgment={judgments[`${transition.fromTrackId}>${transition.toTrackId}`]}
                allowJudging={!editing}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ComparisonTable({ result, current }: { result: PlanResult; current: EvaluatedPlan }) {
  const rows: { label: string; plan: EvaluatedPlan; note?: string }[] = [
    { label: current.label, plan: current },
    ...result.alternatives.map((a) => ({ label: a.label, plan: a })),
    ...result.baselines.map((b) => ({ label: b.label, plan: b.plan, note: "baseline" })),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compared with simpler orderings</CardTitle>
        <CardDescription>
          Every row uses the same selected tracks, constraints, and scoring. Baselines that break an anchor or other constraint are shown with
          their issues instead of being adjusted. Lower objective and costs are better under this scoring; they are not listening results.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ordering</TableHead>
            <TableHead className="text-right">Objective</TableHead>
            <TableHead className="text-right">Mean cost</TableHead>
            <TableHead className="text-right">Worst cost</TableHead>
            <TableHead className="text-right">Arc RMS</TableHead>
            <TableHead className="text-right">Review needed</TableHead>
            <TableHead className="text-right">Constraint issues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell>
                {r.label}
                {r.note ? <span className="text-caption text-muted"> ({r.note})</span> : null}
              </TableCell>
              <TableCell className="text-right text-data">{r.plan.objective.total.toFixed(3)}</TableCell>
              <TableCell className="text-right text-data">{r.plan.metrics.transitionCost.mean.toFixed(2)}</TableCell>
              <TableCell className="text-right text-data">{r.plan.metrics.transitionCost.worst.toFixed(2)}</TableCell>
              <TableCell className="text-right text-data">{r.plan.metrics.arc.rmse === null ? "n/a" : r.plan.metrics.arc.rmse.toFixed(2)}</TableCell>
              <TableCell className="text-right text-data">{formatPercent(r.plan.metrics.reviewNeededShare, 0)}</TableCell>
              <TableCell className="text-right text-data">{r.plan.violations.length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {result.exact ? (
          <TableCaption className="text-left">
            Exhaustive search over {result.exact.permutations.toLocaleString()} orderings found objective {result.exact.objective.toFixed(3)}; the
            original proposal was {formatPercent(result.exact.gap)} above it.
          </TableCaption>
        ) : null}
      </Table>
    </Card>
  );
}

function Method({ request, result }: { request: PlanRequest; result: PlanResult }) {
  const w = request.weights;
  const rows: [string, string][] = [
    ["Mode", request.mode === "dj" ? "DJ preparation" : "Listening flow"],
    ["Selection", request.selectionPolicy === "use_all" ? "Use every candidate" : "Choose from pool"],
    ["Candidates", `${result.pool.candidateCount} (${result.pool.consideredCount} searched), target ${result.pool.targetCount} tracks`],
    [
      "Target duration",
      request.targetDuration ? `${request.targetDuration.minMinutes} to ${request.targetDuration.maxMinutes} min` : "None",
    ],
    ["Energy arc", ARC_PRESET_LABELS[request.energyArc.preset]],
    [
      "Transitions",
      request.mode === "dj"
        ? `max tempo change ${request.preferences.maxTempoAdjustPct}%, minimum played ${request.preferences.minPlayedSeconds} s, ${request.preferences.transitionPreference} type, key lock ${request.preferences.keyLock ? "on" : "off"}`
        : "whole tracks in sequence",
    ],
    ["Artist spacing", `${request.preferences.artistSpacing} tracks`],
    [
      "Transition weights",
      `harmonic ${w.transition.harmonic}, tempo ${w.transition.tempo}, energy step ${w.transition.energyStep}, cue ${w.transition.cue}, vocal ${w.transition.vocal}, style ${w.transition.style}`,
    ],
    ["Objective weights", `mean ${w.meanTransition}, worst ${w.worstTransition}, arc ${w.arc}, diversity ${w.diversity}`],
    ["Search", `beam ${request.search.beamWidth}, branch ${request.search.branchFactor}, seed ${request.search.seed}, budget ${request.search.timeBudgetMs} ms`],
    ["Run", `${result.runtimeMs} ms, ${result.evaluations.toLocaleString()} sequence evaluations, ${new Date(result.generatedAt).toLocaleString()}`],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>How this plan was made</CardTitle>
        <CardDescription>
          Multi-start beam search, then swap, relocate, and (for pools) replace, add, and remove moves under a time budget. Cue regions are
          chosen jointly along the whole order so each middle track keeps a valid played span. This is a heuristic: if it misses a
          constraint, that does not prove no valid plan exists.
        </CardDescription>
      </CardHeader>
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-[200px_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ui text-ink">{k}</dt>
            <dd className="text-[15px]">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function PlanView({
  planId,
  request,
  result,
  plannerTracks,
  judgments,
}: {
  planId: string;
  request: PlanRequest;
  result: PlanResult;
  plannerTracks: PlannerTrack[];
  judgments: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[]>(() => result.proposal.items.map((i) => i.trackId));
  const [reason, setReason] = useState("");
  const [addId, setAddId] = useState("");
  const [message, setMessage] = useState<ActionState>(initialActionState);
  const [pending, startTransition] = useTransition();

  const known = useMemo(() => new Set(plannerTracks.map((t) => t.id)), [plannerTracks]);
  const draft = useMemo(
    () => (editing ? evaluateEditedOrder(plannerTracks, request, order.filter((id) => known.has(id))) : null),
    [editing, plannerTracks, request, order, known],
  );
  const shown = draft ?? result.proposal;
  const arc = arcPoints(request.energyArc);
  const addable = plannerTracks.filter(
    (t) => request.candidateTrackIds.includes(t.id) && (request.repeatPolicy.allowRepeats || !order.includes(t.id)),
  );

  const move = (from: number, to: number) =>
    setOrder((o) => {
      const next = o.slice();
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });

  const startEdit = () => {
    setOrder(result.proposal.items.map((i) => i.trackId));
    setMessage(initialActionState);
    setEditing(true);
  };

  return (
    <div className="flex flex-col gap-10">
      {result.warnings.length > 0 ? (
        <Alert tone="warning">
          <AlertTitle>Limits of this plan</AlertTitle>
          <ul className="mt-2 list-disc pl-5">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {shown.violations.length > 0 ? (
        <Alert tone="error">
          <AlertTitle>Unsatisfied constraints{editing ? " in this draft" : ""}</AlertTitle>
          <ul className="mt-2 list-disc pl-5">
            {shown.violations.map((v, i) => (
              <li key={i}>{v.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <PlanSummary plan={shown} mode={request.mode} />

      <EnergyArcChart
        arc={arc}
        items={chartItems(shown)}
        totalSeconds={shown.metrics.totalSeconds}
        title={editing ? "Energy arc (draft)" : "Energy arc"}
      />

      <Tabs defaultValue="order">
        <TabsList aria-label="Plan sections">
          <TabsTrigger value="order">Set order</TabsTrigger>
          <TabsTrigger value="alternatives">Alternatives ({result.alternatives.length})</TabsTrigger>
          <TabsTrigger value="compare">Comparison</TabsTrigger>
          <TabsTrigger value="method">Method</TabsTrigger>
        </TabsList>

        <TabsContent value="order" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            {editing ? (
              <>
                <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
                  Discard edits
                </Button>
                <p className="text-caption text-muted">Scores update as you edit. Nothing is saved until you choose Save edits.</p>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={startEdit}>
                  <Pencil aria-hidden /> Edit order
                </Button>
                <Button asChild variant="secondary">
                  <a href={`/plans/${planId}/export?format=csv`}>
                    <Download aria-hidden /> CSV
                  </a>
                </Button>
                <Button asChild variant="secondary">
                  <a href={`/plans/${planId}/export?format=json`}>
                    <Download aria-hidden /> JSON
                  </a>
                </Button>
              </>
            )}
          </div>

          {editing ? (
            <Card>
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="add-track">Add a candidate track at the end</Label>
                  <NativeSelect id="add-track" value={addId} onChange={(e) => setAddId(e.target.value)}>
                    <option value="">Choose a track</option>
                    {addable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} · {t.artist}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  variant="secondary"
                  disabled={!addId}
                  onClick={() => {
                    setOrder((o) => [...o, addId]);
                    setAddId("");
                  }}
                >
                  <Plus aria-hidden /> Add
                </Button>
              </div>
            </Card>
          ) : null}

          <SetOrder
            plan={shown}
            planId={planId}
            editing={editing}
            onMove={move}
            onRemove={(i) => setOrder((o) => o.filter((_, j) => j !== i))}
            judgments={judgments}
          />

          {editing ? (
            <Card>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="edit-reason">Reason for the change</Label>
                  <Input id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="Optional, kept with the revision" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    disabled={pending || order.length === 0}
                    aria-busy={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await saveEditedOrder(planId, order, reason);
                        setMessage(res);
                        if (res.ok) setEditing(false);
                      })
                    }
                  >
                    {pending ? "Saving" : "Save edits"}
                  </Button>
                  <p className="text-caption text-muted">
                    Draft objective <span className="text-data">{shown.objective.total.toFixed(3)}</span> versus saved{" "}
                    <span className="text-data">{result.proposal.objective.total.toFixed(3)}</span> (lower is better under this scoring).
                  </p>
                </div>
              </div>
            </Card>
          ) : null}
          <FormMessage state={message} />
        </TabsContent>

        <TabsContent value="alternatives" className="flex flex-col gap-6">
          {result.alternatives.length === 0 ? (
            <p className="text-muted">No sufficiently different plan scored close to the proposal.</p>
          ) : (
            result.alternatives.map((alt, index) => (
              <Card key={alt.label}>
                <CardHeader>
                  <CardTitle>{alt.label}</CardTitle>
                  <CardDescription>
                    Objective {alt.objective.total.toFixed(3)} · {formatTime(alt.metrics.totalSeconds)} · mean cost{" "}
                    {alt.metrics.transitionCost.mean.toFixed(2)} · worst {alt.metrics.transitionCost.worst.toFixed(2)} · {alt.violations.length} constraint
                    issue(s)
                  </CardDescription>
                </CardHeader>
                <ol className="grid list-decimal gap-1 pl-6 md:grid-cols-2">
                  {alt.items.map((it) => (
                    <li key={it.occurrenceId}>
                      {it.title} <span className="text-muted">· {it.artist}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-6">
                  <Button
                    variant="secondary"
                    disabled={pending || editing}
                    onClick={() => startTransition(async () => setMessage(await adoptAlternative(planId, index)))}
                  >
                    Use this alternative
                  </Button>
                </div>
              </Card>
            ))
          )}
          <FormMessage state={message} />
        </TabsContent>

        <TabsContent value="compare">
          <ComparisonTable result={result} current={shown} />
        </TabsContent>

        <TabsContent value="method">
          <Method request={request} result={result} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
