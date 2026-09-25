"use client";

import { Minus, Plus } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { createPlan } from "@/app/actions/plans";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { TrackPicker, type PickerTrack } from "@/components/app/track-picker";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatTime } from "@/lib/domain/format";
import type { Crate, PlanMode } from "@/lib/domain/types";
import {
  ARC_PRESET_LABELS,
  ARC_PRESETS,
  arcPoints,
  defaultPlanRequest,
  MODE_WEIGHTS,
  type ArcPoint,
  type ArcPreset,
  type PlanRequest,
} from "@/lib/planner";
import { initialActionState } from "@/lib/validation/schemas";
import { EnergyArcChart } from "./energy-arc-chart";

type Source = "crate" | "library" | "manual";

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  helper,
  allowEmpty = false,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  helper?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        className="text-data"
        aria-describedby={helper ? `${id}-helper` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === "") {
            if (allowEmpty) onChange(null);
            return;
          }
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      {helper ? (
        <p id={`${id}-helper`} className="text-caption text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function RadioCards<T extends string>({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description: string }[];
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-ui text-ink">{legend}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer gap-3 rounded-[8px] border p-4 ${value === o.value ? "border-action bg-action/5" : "border-control-border/60 bg-surface"}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 size-4 accent-[#1256B2]"
            />
            <span>
              <span className="block text-ui text-ink">{o.label}</span>
              <span className="block text-caption text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PlanRequestForm({
  tracks,
  crates,
  initialCrateId,
}: {
  tracks: PickerTrack[];
  crates: Crate[];
  initialCrateId: string | null;
}) {
  const [state, formAction] = useActionState(createPlan, initialActionState);
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>(initialCrateId ? "crate" : crates.length ? "crate" : "library");
  const [crateId, setCrateId] = useState<string>(initialCrateId ?? crates[0]?.id ?? "");
  const [manual, setManual] = useState<string[]>([]);
  const [request, setRequest] = useState<PlanRequest>(() => defaultPlanRequest("dj"));
  const [limit, setLimit] = useState<"count" | "duration">("duration");
  // Remounts the arc point inputs when a preset replaces them, but not while a point is being typed.
  const [arcVersion, setArcVersion] = useState(0);

  const update = (patch: Partial<PlanRequest>) => setRequest((r) => ({ ...r, ...patch }));

  const candidateIds = useMemo(() => {
    if (source === "library") return tracks.map((t) => t.id);
    if (source === "manual") return manual;
    return crates.find((c) => c.id === crateId)?.trackIds ?? [];
  }, [source, tracks, manual, crates, crateId]);

  const candidates = useMemo(() => {
    const set = new Set(candidateIds);
    return tracks.filter((t) => set.has(t.id));
  }, [candidateIds, tracks]);

  const fullLength = candidates.reduce((s, t) => s + t.durationSeconds, 0);
  const inCandidates = (ids: string[]) => ids.filter((id) => candidateIds.includes(id));

  const setMode = (mode: PlanMode) =>
    setRequest((r) => ({
      ...r,
      mode,
      weights: structuredClone(MODE_WEIGHTS[mode]),
      preferences: { ...r.preferences, minPlayedSeconds: mode === "dj" ? 60 : 0 },
    }));

  const setArcPreset = (preset: ArcPreset) => {
    setArcVersion((v) => v + 1);
    setRequest((r) => ({
      ...r,
      energyArc: {
        preset,
        points:
          preset === "custom"
            ? r.energyArc.points.length
              ? r.energyArc.points
              : ARC_PRESETS.peak.points
            : preset === "none"
              ? []
              : ARC_PRESETS[preset].points,
      },
    }));
  };

  const setArcPoint = (i: number, patch: Partial<ArcPoint>) =>
    setRequest((r) => ({
      ...r,
      energyArc: { preset: "custom", points: r.energyArc.points.map((p, j) => (j === i ? { ...p, ...patch } : p)) },
    }));

  const arc = arcPoints(request.energyArc);
  const dj = request.mode === "dj";
  const pool = request.selectionPolicy === "choose_from_pool";

  const payload = useMemo(() => {
    const req: PlanRequest = {
      ...request,
      candidateTrackIds: candidateIds,
      requiredTrackIds: inCandidates(request.requiredTrackIds),
      excludedTrackIds: inCandidates(request.excludedTrackIds),
      startTrackId: request.startTrackId && candidateIds.includes(request.startTrackId) ? request.startTrackId : null,
      endTrackId: request.endTrackId && candidateIds.includes(request.endTrackId) ? request.endTrackId : null,
      targetCount: pool && limit === "count" ? (request.targetCount ?? 20) : null,
      targetDuration: pool && limit === "duration" ? request.targetDuration : null,
    };
    return JSON.stringify({ name: name.trim() || "Untitled plan", crateId: source === "crate" && crateId ? crateId : null, request: req });
  }, [request, candidateIds, name, source, crateId, limit, pool]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="payload" value={payload} />

      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-6">
          <div className="flex max-w-md flex-col gap-2">
            <Label htmlFor="plan-name">Name</Label>
            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday warm-up" maxLength={120} />
          </div>
          <RadioCards<PlanMode>
            name="mode"
            legend="Mode"
            value={request.mode}
            onChange={setMode}
            options={[
              {
                value: "dj",
                label: "DJ preparation",
                description: "Entry and exit regions, overlaps, tempo changes, and transition types. Duration counts played spans.",
              },
              {
                value: "listening",
                label: "Listening flow",
                description: "Whole tracks in sequence, weighted toward pacing and variety. Key matters less without overlap.",
              },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracks</CardTitle>
          <CardDescription>
            {candidates.length} candidate tracks · {formatTime(fullLength)} at full length
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="source">Candidates from</Label>
              <NativeSelect id="source" value={source} onChange={(e) => setSource(e.target.value as Source)}>
                <option value="crate" disabled={crates.length === 0}>
                  A crate
                </option>
                <option value="library">The whole library</option>
                <option value="manual">Tracks I pick</option>
              </NativeSelect>
            </div>
            {source === "crate" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="crate">Crate</Label>
                <NativeSelect id="crate" value={crateId} onChange={(e) => setCrateId(e.target.value)}>
                  {crates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.trackIds.length})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </div>
          {source === "manual" ? <TrackPicker label="Candidate tracks" tracks={tracks} selected={manual} onChange={setManual} /> : null}

          <RadioCards<PlanRequest["selectionPolicy"]>
            name="selection"
            legend="Selection"
            value={request.selectionPolicy}
            onChange={(selectionPolicy) => {
              update({ selectionPolicy });
              if (selectionPolicy === "choose_from_pool" && request.targetDuration === null && request.targetCount === null) {
                update({ selectionPolicy, targetDuration: { minMinutes: 55, maxMinutes: 65 } });
              }
            }}
            options={[
              { value: "use_all", label: "Use every candidate", description: "Reorder a fixed crate. Every track plays once." },
              {
                value: "choose_from_pool",
                label: "Choose from the pool",
                description: "Select tracks as well as order them, to a target count or duration.",
              },
            ]}
          />

          {pool ? (
            <div className="flex flex-col gap-4">
              <fieldset className="flex flex-wrap gap-6">
                <legend className="mb-2 text-ui text-ink">Target</legend>
                {(["duration", "count"] as const).map((v) => (
                  <label key={v} className="inline-flex min-h-11 items-center gap-2">
                    <input type="radio" name="limit" checked={limit === v} onChange={() => setLimit(v)} className="size-4 accent-[#1256B2]" />
                    {v === "duration" ? "Duration" : "Track count"}
                  </label>
                ))}
              </fieldset>
              {limit === "count" ? (
                <div className="max-w-xs">
                  <NumberField id="target-count" label="Number of tracks" value={request.targetCount ?? 20} min={1} max={500} onChange={(v) => update({ targetCount: v })} />
                </div>
              ) : (
                <div className="grid max-w-md gap-4 sm:grid-cols-2">
                  <NumberField
                    id="duration-min"
                    label="Minimum minutes"
                    value={request.targetDuration?.minMinutes ?? 55}
                    min={1}
                    max={1440}
                    onChange={(v) => update({ targetDuration: { minMinutes: v ?? 1, maxMinutes: request.targetDuration?.maxMinutes ?? 65 } })}
                  />
                  <NumberField
                    id="duration-max"
                    label="Maximum minutes"
                    value={request.targetDuration?.maxMinutes ?? 65}
                    min={1}
                    max={1440}
                    onChange={(v) => update({ targetDuration: { minMinutes: request.targetDuration?.minMinutes ?? 55, maxMinutes: v ?? 1 } })}
                  />
                </div>
              )}
              <label className="inline-flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={request.repeatPolicy.allowRepeats}
                  onCheckedChange={(v) => update({ repeatPolicy: { ...request.repeatPolicy, allowRepeats: v === true } })}
                />
                Allow a track to repeat
              </label>
              {request.repeatPolicy.allowRepeats ? (
                <div className="max-w-xs">
                  <NumberField
                    id="repeat-gap"
                    label="Minimum tracks between repeats"
                    value={request.repeatPolicy.minGapTracks}
                    min={0}
                    max={200}
                    onChange={(v) => update({ repeatPolicy: { ...request.repeatPolicy, minGapTracks: v ?? 0 } })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="start-track">Opening track</Label>
              <NativeSelect id="start-track" value={request.startTrackId ?? ""} onChange={(e) => update({ startTrackId: e.target.value || null })}>
                <option value="">Planner chooses</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.artist}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="end-track">Closing track</Label>
              <NativeSelect id="end-track" value={request.endTrackId ?? ""} onChange={(e) => update({ endTrackId: e.target.value || null })}>
                <option value="">Planner chooses</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.artist}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <details className="rounded-[8px] border border-divider p-4">
            <summary className="min-h-11 cursor-pointer py-2 text-ui text-ink">
              Required and excluded tracks ({inCandidates(request.requiredTrackIds).length} required, {inCandidates(request.excludedTrackIds).length}{" "}
              excluded)
            </summary>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <TrackPicker
                label="Required"
                tracks={candidates}
                selected={inCandidates(request.requiredTrackIds)}
                onChange={(ids) => update({ requiredTrackIds: ids, excludedTrackIds: request.excludedTrackIds.filter((x) => !ids.includes(x)) })}
                maxHeight={280}
              />
              <TrackPicker
                label="Excluded"
                tracks={candidates}
                selected={inCandidates(request.excludedTrackIds)}
                onChange={(ids) => update({ excludedTrackIds: ids, requiredTrackIds: request.requiredTrackIds.filter((x) => !ids.includes(x)) })}
                maxHeight={280}
              />
            </div>
          </details>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Energy arc</CardTitle>
          <CardDescription>
            Scored against elapsed planned playback time using your relative energy annotations. Tracks without an annotation get a neutral
            penalty and are listed in the result.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-6">
          <div className="max-w-sm">
            <Label htmlFor="arc-preset">Shape</Label>
            <div className="mt-2">
              <NativeSelect id="arc-preset" value={request.energyArc.preset} onChange={(e) => setArcPreset(e.target.value as ArcPreset)}>
                {(Object.keys(ARC_PRESET_LABELS) as ArcPreset[]).map((p) => (
                  <option key={p} value={p}>
                    {ARC_PRESET_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {request.energyArc.preset !== "none" ? (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-ui text-ink">Control points (editing switches to Custom)</legend>
              {request.energyArc.points.map((p, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <NumberField
                      key={`t-${arcVersion}-${i}`}
                      id={`arc-t-${i}`}
                      label="Elapsed %"
                      value={Math.round(p.t * 100)}
                      min={0}
                      max={100}
                      onChange={(v) => setArcPoint(i, { t: (v ?? 0) / 100 })}
                    />
                  </div>
                  <div className="w-36">
                    <NumberField
                      key={`e-${arcVersion}-${i}`}
                      id={`arc-e-${i}`}
                      label="Energy"
                      value={p.energy}
                      min={1}
                      max={10}
                      step={0.5}
                      onChange={(v) => setArcPoint(i, { energy: v ?? 1 })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove point ${i + 1}`}
                    disabled={request.energyArc.points.length <= 2}
                    onClick={() => {
                      setArcVersion((v) => v + 1);
                      setRequest((r) => ({ ...r, energyArc: { preset: "custom", points: r.energyArc.points.filter((_, j) => j !== i) } }));
                    }}
                  >
                    <Minus aria-hidden />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={request.energyArc.points.length >= 12}
                  onClick={() =>
                    setRequest((r) => ({
                      ...r,
                      energyArc: { preset: "custom", points: [...r.energyArc.points, { t: 1, energy: r.energyArc.points.at(-1)?.energy ?? 6 }] },
                    }))
                  }
                >
                  <Plus aria-hidden /> Add point
                </Button>
              </div>
            </fieldset>
          ) : null}
          <EnergyArcChart arc={arc} totalSeconds={null} title="Target arc preview" />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {dj ? (
            <>
              <NumberField
                id="max-tempo"
                label="Largest tempo change for a blend (%)"
                value={request.preferences.maxTempoAdjustPct}
                min={0}
                max={20}
                step={0.5}
                helper="Beyond this, the planner suggests a cut."
                onChange={(v) => update({ preferences: { ...request.preferences, maxTempoAdjustPct: v ?? 0 } })}
              />
              <NumberField
                id="min-played"
                label="Minimum played span (seconds)"
                value={request.preferences.minPlayedSeconds}
                min={0}
                max={600}
                helper="Each track must play at least this long between its entry and exit."
                onChange={(v) => update({ preferences: { ...request.preferences, minPlayedSeconds: v ?? 0 } })}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="transition-pref">Transition type</Label>
                <NativeSelect
                  id="transition-pref"
                  value={request.preferences.transitionPreference}
                  onChange={(e) =>
                    update({ preferences: { ...request.preferences, transitionPreference: e.target.value as PlanRequest["preferences"]["transitionPreference"] } })
                  }
                >
                  <option value="auto">Suggest per transition</option>
                  <option value="blend">Prefer blends where tempo allows</option>
                  <option value="cut">Cuts only</option>
                </NativeSelect>
              </div>
              <label className="inline-flex min-h-11 items-center gap-3">
                <Checkbox
                  checked={request.preferences.keyLock}
                  onCheckedChange={(v) => update({ preferences: { ...request.preferences, keyLock: v === true } })}
                />
                Key lock on (tempo changes keep the original pitch)
              </label>
            </>
          ) : null}
          <NumberField
            id="artist-spacing"
            label="Tracks between same artist or remix family"
            value={request.preferences.artistSpacing}
            min={0}
            max={20}
            onChange={(v) => update({ preferences: { ...request.preferences, artistSpacing: v ?? 0 } })}
          />
        </div>

        <details className="mt-6 rounded-[8px] border border-divider p-4">
          <summary className="min-h-11 cursor-pointer py-2 text-ui text-ink">Scoring weights and search budget</summary>
          <p className="mt-2 text-caption text-muted">
            Starting weights are declared assumptions for this mode, not fitted values. Changing them changes what the planner prefers.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["harmonic", "Harmonic"],
                ["tempo", "Tempo"],
                ["energyStep", "Energy step"],
                ["cue", "Cue review state"],
                ["vocal", "Vocal overlap"],
                ["style", "Style continuity"],
              ] as const
            ).map(([k, label]) => (
              <NumberField
                key={`${request.mode}-${k}`}
                id={`w-${k}`}
                label={label}
                value={request.weights.transition[k]}
                min={0}
                max={10}
                step={0.05}
                onChange={(v) => update({ weights: { ...request.weights, transition: { ...request.weights.transition, [k]: v ?? 0 } } })}
              />
            ))}
            {(
              [
                ["meanTransition", "Mean transition"],
                ["worstTransition", "Worst transition"],
                ["arc", "Energy arc"],
                ["diversity", "Diversity and spacing"],
              ] as const
            ).map(([k, label]) => (
              <NumberField
                key={`${request.mode}-${k}`}
                id={`w-${k}`}
                label={label}
                value={request.weights[k]}
                min={0}
                max={10}
                step={0.05}
                onChange={(v) => update({ weights: { ...request.weights, [k]: v ?? 0 } })}
              />
            ))}
            <NumberField
              id="beam"
              label="Beam width"
              value={request.search.beamWidth}
              min={1}
              max={64}
              onChange={(v) => update({ search: { ...request.search, beamWidth: v ?? 1 } })}
            />
            <NumberField
              id="budget"
              label="Time budget (ms)"
              value={request.search.timeBudgetMs}
              min={200}
              max={10000}
              step={100}
              onChange={(v) => update({ search: { ...request.search, timeBudgetMs: v ?? 200 } })}
            />
            <NumberField
              id="max-candidates"
              label="Candidates searched"
              value={request.search.maxCandidates}
              min={2}
              max={400}
              helper="Larger pools are pruned across energy bands."
              onChange={(v) => update({ search: { ...request.search, maxCandidates: v ?? 2 } })}
            />
            <NumberField
              id="seed"
              label="Seed"
              value={request.search.seed}
              min={0}
              max={2147483647}
              onChange={(v) => update({ search: { ...request.search, seed: v ?? 0 } })}
            />
          </div>
        </details>
      </Card>

      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton disabled={candidates.length === 0} pendingLabel="Planning">
          Plan set
        </SubmitButton>
        {candidates.length === 0 ? <p className="text-caption text-muted">Choose candidate tracks first.</p> : null}
      </div>
    </form>
  );
}
