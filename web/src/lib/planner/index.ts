import { usableKey } from "@/lib/domain/camelot";
import { runBaselines } from "./baselines";
import { evaluateSequence, PlanningContext } from "./evaluate";
import { exactOrder } from "./exact";
import { beamSearch, improve, sequenceSimilarity, type SearchSetup } from "./search";
import {
  PlanRequestError,
  type EvaluatedPlan,
  type PlanRequest,
  type PlanResult,
  type PlannerTrack,
  type RequestProblem,
} from "./types";

export * from "./types";
export { defaultPlanRequest, ARC_PRESETS, ARC_PRESET_LABELS, MODE_WEIGHTS } from "./defaults";
export { arcPoints, sampleArc, targetEnergyAt } from "./arc";
export { evaluateTransition, matchTempo } from "./transition";
export { PlanningContext, evaluateSequence } from "./evaluate";

interface PreparedRequest {
  request: PlanRequest;
  candidates: string[];
  warnings: string[];
}

/** Checks a request against the library and normalizes it. Throws PlanRequestError on conflicts. */
export function prepareRequest(tracks: PlannerTrack[], request: PlanRequest): PreparedRequest {
  const problems: RequestProblem[] = [];
  const warnings: string[] = [];
  const known = new Set(tracks.map((t) => t.id));
  const excluded = new Set(request.excludedTrackIds);

  const unknown = request.candidateTrackIds.filter((id) => !known.has(id));
  if (unknown.length > 0) warnings.push(`${unknown.length} candidate track(s) no longer exist and were ignored.`);
  const candidates = [...new Set(request.candidateTrackIds.filter((id) => known.has(id) && !excluded.has(id)))];

  if (candidates.length === 0) problems.push({ field: "candidateTrackIds", message: "Choose at least one track that is not excluded." });

  for (const id of request.requiredTrackIds) {
    if (excluded.has(id)) problems.push({ field: "requiredTrackIds", message: "A track cannot be both required and excluded." });
    else if (!candidates.includes(id)) problems.push({ field: "requiredTrackIds", message: "Every required track must be among the candidates." });
  }
  for (const [field, id] of [
    ["startTrackId", request.startTrackId],
    ["endTrackId", request.endTrackId],
  ] as const) {
    if (id && !candidates.includes(id)) problems.push({ field, message: "Opening and closing tracks must be candidates and not excluded." });
  }
  if (request.startTrackId && request.startTrackId === request.endTrackId && !request.repeatPolicy.allowRepeats) {
    problems.push({ field: "endTrackId", message: "The same track cannot open and close the set unless repeats are allowed." });
  }

  const d = request.targetDuration;
  if (d) {
    if (!(d.minMinutes > 0) || !(d.maxMinutes > 0) || d.minMinutes > d.maxMinutes) {
      problems.push({ field: "targetDuration", message: "Duration needs a positive minimum no larger than the maximum." });
    }
  }

  const anchored = new Set([...request.requiredTrackIds, request.startTrackId, request.endTrackId].filter(Boolean));
  if (request.selectionPolicy === "choose_from_pool") {
    if (request.targetCount === null && request.targetDuration === null) {
      problems.push({
        field: "targetCount",
        message: "Selecting from a pool needs a target track count or duration; otherwise the cheapest plan is trivially short.",
      });
    }
    if (request.targetCount !== null) {
      if (request.targetCount < Math.max(1, anchored.size)) {
        problems.push({ field: "targetCount", message: "The target count is smaller than the number of required and anchored tracks." });
      }
      if (!request.repeatPolicy.allowRepeats && request.targetCount > candidates.length) {
        problems.push({ field: "targetCount", message: `Only ${candidates.length} candidate tracks are available without repeats.` });
      }
    }
  }

  if (problems.length > 0) throw new PlanRequestError(problems);

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const pool = candidates.map((id) => byId.get(id)!);
  const noEnergy = pool.filter((t) => t.energy === null).length;
  const noKey = pool.filter((t) => usableKey(t.keyTonic, t.keyMode, t.keyStatus) === null).length;
  const noBpm = pool.filter((t) => t.bpm === null).length;
  if (request.energyArc.preset !== "none" && noEnergy > 0) {
    warnings.push(`${noEnergy} track(s) have no energy annotation; the arc term uses a neutral penalty for them.`);
  }
  if (noKey > 0) warnings.push(`${noKey} track(s) have no usable key; harmonic evidence is marked missing for their transitions.`);
  if (noBpm > 0 && request.mode === "dj") warnings.push(`${noBpm} track(s) have no tempo; their transitions default to cuts.`);
  if (request.mode === "dj") {
    const noCues = pool.filter((t) => !t.cues.some((c) => c.reviewStatus !== "rejected")).length;
    if (noCues > 0) warnings.push(`${noCues} track(s) have no cue regions; intro and outro windows are used and flagged for review.`);
  }

  return { request, candidates, warnings };
}

/** Keeps required and anchored tracks, then fills the pool round-robin across energy bands so every arc stage keeps candidates. */
function pruneCandidates(ctx: PlanningContext, candidates: string[]): string[] {
  const req = ctx.request;
  const limit = Math.max(req.search.maxCandidates, 2);
  if (candidates.length <= limit) return candidates;

  const keep = new Set([...req.requiredTrackIds, req.startTrackId, req.endTrackId].filter((x): x is string => !!x));
  const completeness = (id: string) => {
    const t = ctx.track(id);
    return (
      (t.bpm !== null ? 1 : 0) +
      (usableKey(t.keyTonic, t.keyMode, t.keyStatus) ? 1 : 0) +
      (t.energy !== null ? 1 : 0) +
      (t.cues.some((c) => c.reviewStatus === "approved") ? 1 : 0)
    );
  };
  const bands = new Map<string, string[]>();
  for (const id of candidates) {
    if (keep.has(id)) continue;
    const e = ctx.track(id).energy;
    const band = e === null ? "unknown" : String(Math.min(4, Math.floor((e - 1) / 2)));
    const list = bands.get(band) ?? [];
    list.push(id);
    bands.set(band, list);
  }
  for (const list of bands.values()) list.sort((a, b) => completeness(b) - completeness(a) || a.localeCompare(b));
  const order = [...bands.keys()].sort();
  const result = [...keep];
  let added = true;
  while (result.length < limit && added) {
    added = false;
    for (const band of order) {
      const next = bands.get(band)!.shift();
      if (next !== undefined && result.length < limit) {
        result.push(next);
        added = true;
      }
    }
  }
  return result;
}

function resolveTargetCount(ctx: PlanningContext, pool: string[]): number {
  const req = ctx.request;
  if (req.selectionPolicy === "use_all") return pool.length;
  const minimum = new Set([...req.requiredTrackIds, req.startTrackId, req.endTrackId].filter(Boolean)).size;
  const maximum = req.repeatPolicy.allowRepeats ? Math.max(pool.length, 200) : pool.length;
  let count: number;
  if (req.targetCount !== null) count = req.targetCount;
  else {
    const target = ctx.targetDurationSeconds()!;
    const avg = pool.reduce((s, id) => s + ctx.typicalPlayed(id), 0) / Math.max(1, pool.length);
    count = Math.round((target.min + target.max) / 2 / Math.max(1, avg));
  }
  return Math.min(maximum, Math.max(minimum, 1, count));
}

/**
 * Plans an ordered set. Deterministic for a given library, request, and seed,
 * apart from where the time budget cuts the local search short.
 */
export function planSet(tracks: PlannerTrack[], request: PlanRequest): PlanResult {
  const started = Date.now();
  const prepared = prepareRequest(tracks, request);
  const ctx = new PlanningContext(tracks, prepared.request);
  const budget = Math.max(200, request.search.timeBudgetMs);
  const deadline = started + budget;

  const pool = pruneCandidates(ctx, prepared.candidates);
  const targetCount = resolveTargetCount(ctx, pool);
  const warnings = [...prepared.warnings];
  if (pool.length < prepared.candidates.length) {
    warnings.push(`The search considered ${pool.length} of ${prepared.candidates.length} candidates, keeping required tracks and every energy band.`);
  }

  const setup: SearchSetup = {
    ctx,
    pool,
    targetCount,
    deadline: started + budget * 0.3,
  };
  const starts = beamSearch(setup);
  setup.deadline = deadline;

  // Improve several distinct beam results; share the remaining budget.
  const startCount = Math.min(starts.length, Math.max(1, request.search.alternatives + 2));
  const improved: EvaluatedPlan[] = [];
  for (let i = 0; i < startCount; i++) {
    const remaining = deadline - Date.now();
    const slice = Math.max(20, remaining / (startCount - i));
    improved.push(improve(setup, starts[i]!, "Proposed plan", Date.now() + slice));
  }
  improved.sort((a, b) => a.objective.total - b.objective.total);

  const proposal = improved[0]!;
  const proposalSeq = proposal.items.map((it) => it.trackId);
  const alternatives: EvaluatedPlan[] = [];
  const chosen = [proposalSeq];
  for (const plan of improved.slice(1)) {
    if (alternatives.length >= request.search.alternatives) break;
    const seq = plan.items.map((it) => it.trackId);
    const close = plan.objective.total <= proposal.objective.total * 1.3 + 0.1;
    const different = chosen.every((c) => sequenceSimilarity(c, seq) < 0.75);
    if (close && different) {
      alternatives.push({ ...plan, label: `Alternative ${alternatives.length + 1}` });
      chosen.push(seq);
    }
  }

  const baselines = runBaselines(ctx, proposalSeq, request.search.seed);

  let exact: PlanResult["exact"] = null;
  if (request.selectionPolicy === "use_all") {
    const found = exactOrder(ctx, pool, Date.now() + Math.max(500, budget));
    if (found) {
      const gap = (proposal.objective.total - found.objective) / Math.max(found.objective, 1e-9);
      exact = { objective: found.objective, gap: Math.max(0, gap), permutations: found.permutations };
    }
  }

  if (proposal.violations.length > 0) {
    warnings.push("The search did not satisfy every constraint. A heuristic failure does not prove that no valid plan exists.");
  }

  return {
    version: 1,
    mode: request.mode,
    generatedAt: new Date().toISOString(),
    runtimeMs: Date.now() - started,
    evaluations: ctx.evaluations,
    proposal: { ...proposal, label: "Proposed plan" },
    alternatives,
    baselines,
    exact,
    warnings,
    pool: { candidateCount: prepared.candidates.length, consideredCount: pool.length, targetCount },
  };
}

/** Re-evaluates a manually edited order against the original request. */
export function evaluateEditedOrder(tracks: PlannerTrack[], request: PlanRequest, order: string[]): EvaluatedPlan {
  const ctx = new PlanningContext(tracks, request);
  return evaluateSequence(ctx, order, "Edited plan");
}
