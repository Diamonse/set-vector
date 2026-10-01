import { usableKey } from "@/lib/domain/camelot";
import { arcPoints, targetEnergyAt } from "./arc";
import { cueOptions, typicalPlayedSeconds } from "./options";
import { evaluateTransition, type TransitionContext } from "./transition";
import type {
  ArcPoint,
  CueOption,
  EvaluatedPlan,
  ObjectiveBreakdown,
  PlanItem,
  PlanMetrics,
  PlanRequest,
  PlannerTrack,
  Transition,
  Violation,
} from "./types";

/** Cost added to a cue path whose played span is too short; it keeps the DP total finite. */
const INFEASIBLE_STEP = 5;
const HARD_PENALTY = 3;

/**
 * Shared, cached state for evaluating many candidate sequences of one request.
 * Pair transitions are computed lazily; no library-wide pair matrix is built.
 */
export class PlanningContext {
  readonly tracks: Map<string, PlannerTrack>;
  readonly arc: ArcPoint[] | null;
  readonly transitionContext: TransitionContext;
  evaluations = 0;
  private readonly entries = new Map<string, CueOption[]>();
  private readonly exits = new Map<string, CueOption[]>();
  private readonly pairs = new Map<string, Transition>();
  private readonly bestPairs = new Map<string, number>();
  private readonly typical = new Map<string, number>();

  constructor(
    tracks: PlannerTrack[],
    readonly request: PlanRequest,
  ) {
    this.tracks = new Map(tracks.map((t) => [t.id, t]));
    this.arc = arcPoints(request.energyArc);
    this.transitionContext = {
      mode: request.mode,
      preferences: request.preferences,
      weights: request.weights.transition,
    };
  }

  track(id: string): PlannerTrack {
    const t = this.tracks.get(id);
    if (!t) throw new Error(`Unknown track ${id}`);
    return t;
  }

  entryOptions(id: string): CueOption[] {
    let opts = this.entries.get(id);
    if (!opts) {
      opts = cueOptions(this.track(id), "entry", this.request.mode);
      this.entries.set(id, opts);
    }
    return opts;
  }

  exitOptions(id: string): CueOption[] {
    let opts = this.exits.get(id);
    if (!opts) {
      opts = cueOptions(this.track(id), "exit", this.request.mode);
      this.exits.set(id, opts);
    }
    return opts;
  }

  typicalPlayed(id: string): number {
    let v = this.typical.get(id);
    if (v === undefined) {
      v = typicalPlayedSeconds(this.track(id), this.request.mode);
      this.typical.set(id, v);
    }
    return v;
  }

  transition(exit: CueOption, entry: CueOption): Transition {
    const key = `${exit.id}>${entry.id}`;
    let t = this.pairs.get(key);
    if (!t) {
      t = evaluateTransition(this.track(exit.trackId), exit, this.track(entry.trackId), entry, this.transitionContext);
      this.pairs.set(key, t);
    }
    return t;
  }

  /** Lowest transition cost over all cue pairs, ignoring cross-track cue feasibility. Used to guide search. */
  bestPairCost(fromId: string, toId: string): number {
    const key = `${fromId}>${toId}`;
    let v = this.bestPairs.get(key);
    if (v === undefined) {
      v = Infinity;
      for (const x of this.exitOptions(fromId)) {
        for (const e of this.entryOptions(toId)) v = Math.min(v, this.transition(x, e).cost);
      }
      this.bestPairs.set(key, v);
    }
    return v;
  }

  targetDurationSeconds(): { min: number; max: number } | null {
    const d = this.request.targetDuration;
    return d ? { min: d.minMinutes * 60, max: d.maxMinutes * 60 } : null;
  }
}

interface CuePath {
  entries: CueOption[];
  exits: CueOption[];
  transitions: Transition[];
  infeasibleAt: number[];
}

/** Chooses entry and exit regions jointly along the sequence (Viterbi over entry choices). */
function assignCues(ctx: PlanningContext, seq: string[]): CuePath {
  const n = seq.length;
  const dj = ctx.request.mode === "dj";
  const minPlayed = dj ? ctx.request.preferences.minPlayedSeconds : 0;

  const entryOpts = seq.map((id) => ctx.entryOptions(id));
  const exitOpts = seq.map((id) => ctx.exitOptions(id));

  // cost[i][e]: best cost to enter track i with entry option e.
  const cost: number[][] = entryOpts.map((opts) => opts.map(() => Infinity));
  const back: { prevEntry: number; exit: number }[][] = entryOpts.map((opts) => opts.map(() => ({ prevEntry: -1, exit: -1 })));
  cost[0] = entryOpts[0]!.map((e) => e.startSeconds * 1e-6);

  for (let i = 0; i < n - 1; i++) {
    const track = ctx.track(seq[i]!);
    for (let ei = 0; ei < entryOpts[i]!.length; ei++) {
      const base = cost[i]![ei]!;
      if (!Number.isFinite(base)) continue;
      const entry = entryOpts[i]![ei]!;
      for (let xi = 0; xi < exitOpts[i]!.length; xi++) {
        const exit = exitOpts[i]![xi]!;
        const played = exit.startSeconds - entry.startSeconds;
        const infeasible = dj && (played < minPlayed || played <= 0 || exit.startSeconds >= track.durationSeconds);
        for (let ni = 0; ni < entryOpts[i + 1]!.length; ni++) {
          const t = ctx.transition(exit, entryOpts[i + 1]![ni]!);
          const c = base + t.cost + (infeasible ? INFEASIBLE_STEP : 0);
          if (c < cost[i + 1]![ni]!) {
            cost[i + 1]![ni] = c;
            back[i + 1]![ni] = { prevEntry: ei, exit: xi };
          }
        }
      }
    }
  }

  // Close the path: the last track plays from its entry to the end of the file.
  const lastIdx = n - 1;
  const lastTrack = ctx.track(seq[lastIdx]!);
  let bestLast = 0;
  let bestLastCost = Infinity;
  entryOpts[lastIdx]!.forEach((e, ei) => {
    const tail = lastTrack.durationSeconds - e.startSeconds;
    const c = cost[lastIdx]![ei]! + (dj && tail < minPlayed ? INFEASIBLE_STEP : 0);
    if (c < bestLastCost) {
      bestLastCost = c;
      bestLast = ei;
    }
  });

  const entryIdx: number[] = new Array(n).fill(0);
  const exitIdx: number[] = new Array(n).fill(0);
  entryIdx[lastIdx] = bestLast;
  exitIdx[lastIdx] = exitOpts[lastIdx]!.length - 1;
  for (let i = lastIdx; i > 0; i--) {
    const b = back[i]![entryIdx[i]!]!;
    entryIdx[i - 1] = b.prevEntry;
    exitIdx[i - 1] = b.exit;
  }

  const entries = entryIdx.map((ei, i) => entryOpts[i]![ei]!);
  const exits = exitIdx.map((xi, i) => exitOpts[i]![xi]!);
  const transitions: Transition[] = [];
  const infeasibleAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const track = ctx.track(seq[i]!);
    const end = i < n - 1 ? exits[i]!.startSeconds : track.durationSeconds;
    if (dj && end - entries[i]!.startSeconds < Math.max(minPlayed, 1e-6)) infeasibleAt.push(i);
    if (i < n - 1) transitions.push(ctx.transition(exits[i]!, entries[i + 1]!));
  }
  return { entries, exits, transitions, infeasibleAt };
}

function artistTokens(artist: string): string[] {
  return artist
    .toLowerCase()
    .split(/,|&|\bfeat\.?|\bft\.?|\bx\b|\/|;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function constraintViolations(ctx: PlanningContext, seq: string[]): Violation[] {
  const req = ctx.request;
  const violations: Violation[] = [];
  const present = new Set(seq);

  for (const id of seq) {
    if (!ctx.tracks.has(id)) violations.push({ code: "unknown_track", message: `Track ${id} is not in the library` });
  }
  for (const id of req.requiredTrackIds) {
    if (!present.has(id)) {
      violations.push({ code: "missing_required", message: `Required track "${ctx.tracks.get(id)?.title ?? id}" is missing` });
    }
  }
  const excluded = new Set(req.excludedTrackIds);
  seq.forEach((id, position) => {
    if (excluded.has(id)) {
      violations.push({ code: "excluded_present", message: `Excluded track "${ctx.tracks.get(id)?.title ?? id}" is included`, position });
    }
  });
  if (req.startTrackId && seq[0] !== req.startTrackId) {
    violations.push({ code: "start_anchor", message: "The set does not start with the fixed opening track", position: 0 });
  }
  if (req.endTrackId && seq[seq.length - 1] !== req.endTrackId) {
    violations.push({ code: "end_anchor", message: "The set does not end with the fixed closing track", position: seq.length - 1 });
  }

  const lastSeen = new Map<string, number>();
  seq.forEach((id, position) => {
    const prev = lastSeen.get(id);
    if (prev !== undefined) {
      const gap = position - prev - 1;
      if (!req.repeatPolicy.allowRepeats) {
        violations.push({ code: "repeat", message: `"${ctx.tracks.get(id)?.title ?? id}" plays more than once`, position });
      } else if (gap < req.repeatPolicy.minGapTracks) {
        violations.push({
          code: "repeat",
          message: `"${ctx.tracks.get(id)?.title ?? id}" repeats after ${gap} tracks (minimum ${req.repeatPolicy.minGapTracks})`,
          position,
        });
      }
    }
    lastSeen.set(id, position);
  });

  if (req.selectionPolicy === "use_all") {
    const missing = req.candidateTrackIds.filter((id) => !excluded.has(id) && !present.has(id));
    if (missing.length > 0) {
      violations.push({ code: "count", message: `${missing.length} supplied track(s) are not in the plan` });
    }
  } else if (req.targetCount !== null && req.targetDuration === null && seq.length !== req.targetCount) {
    violations.push({ code: "count", message: `The plan has ${seq.length} tracks; ${req.targetCount} were requested` });
  }
  return violations;
}

/** Evaluates one ordered sequence of track IDs: cue assignment, timing, metrics, constraints, and objective. */
export function evaluateSequence(ctx: PlanningContext, seq: string[], label: string): EvaluatedPlan {
  ctx.evaluations++;
  const req = ctx.request;
  const weights = req.weights;
  const violations = constraintViolations(ctx, seq);
  const known = seq.filter((id) => ctx.tracks.has(id));

  if (known.length === 0) {
    const objective: ObjectiveBreakdown = {
      meanTransition: 0,
      worstTransition: 0,
      arc: 0,
      diversity: 0,
      duration: 0,
      hardPenalty: HARD_PENALTY * Math.max(1, violations.length),
      total: HARD_PENALTY * Math.max(1, violations.length),
    };
    return {
      label,
      items: [],
      transitions: [],
      violations: violations.length ? violations : [{ code: "count", message: "The plan is empty" }],
      objective,
      metrics: emptyMetrics(),
    };
  }

  const path = assignCues(ctx, known);
  for (const position of path.infeasibleAt) {
    violations.push({
      code: "cue_conflict",
      message: `"${ctx.track(known[position]!).title}" has no valid played span between its chosen entry and exit`,
      position,
    });
  }

  // Timeline by elapsed planned playback time.
  const items: PlanItem[] = [];
  let elapsed = 0;
  const advances: number[] = [];
  for (let i = 0; i < known.length; i++) {
    const track = ctx.track(known[i]!);
    const entry = path.entries[i]!;
    const exit = path.exits[i]!;
    const isLast = i === known.length - 1;
    let playStart: number;
    let playEnd: number;
    let advance: number;
    if (req.mode === "listening") {
      playStart = 0;
      playEnd = track.durationSeconds;
      advance = track.durationSeconds;
    } else {
      playStart = entry.startSeconds;
      if (isLast) {
        playEnd = track.durationSeconds;
        advance = playEnd - playStart;
      } else {
        const overlap = path.transitions[i]!.overlapSeconds;
        playEnd = Math.min(track.durationSeconds, exit.startSeconds + overlap);
        advance = Math.max(0, exit.startSeconds - playStart);
      }
    }
    advances.push(advance);
    items.push({
      occurrenceId: `occ-${i + 1}-${track.id.slice(0, 8)}`,
      position: i,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      entryOptionId: entry.id,
      exitOptionId: isLast ? `${track.id}:end` : exit.id,
      entryLabel: req.mode === "listening" ? "Track start" : entry.label,
      exitLabel: req.mode === "listening" || isLast ? "Track end" : exit.label,
      entryOrigin: entry.origin,
      exitOrigin: isLast ? "full_track" : exit.origin,
      playStartSeconds: playStart,
      playEndSeconds: playEnd,
      elapsedStartSeconds: elapsed,
      playedSeconds: Math.max(0, playEnd - playStart),
      energy: track.energy,
      targetEnergy: null,
    });
    elapsed += advance;
  }
  const totalSeconds = elapsed;

  // Energy arc deviation, weighted by the time each track occupies.
  let arcCost = 0;
  let arcRmse: number | null = null;
  let arcCoverage = 0;
  if (ctx.arc && totalSeconds > 0) {
    let sq = 0;
    let wKnown = 0;
    items.forEach((item, i) => {
      const w = advances[i]!;
      const mid = (item.elapsedStartSeconds + w / 2) / totalSeconds;
      item.targetEnergy = targetEnergyAt(ctx.arc!, mid);
      if (item.energy !== null && w > 0) {
        sq += w * (item.energy - item.targetEnergy) ** 2;
        wKnown += w;
      }
    });
    arcCoverage = wKnown / totalSeconds;
    if (wKnown > 0) {
      arcRmse = Math.sqrt(sq / wKnown);
      arcCost = (arcRmse / 9) * arcCoverage + 0.15 * (1 - arcCoverage);
    } else {
      arcCost = 0.15;
    }
  }

  // Transition statistics.
  const costs = path.transitions.map((t) => t.cost);
  const mean = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  let worst = 0;
  let worstIndex: number | null = null;
  costs.forEach((c, i) => {
    if (c > worst || worstIndex === null) {
      worst = c;
      worstIndex = i;
    }
  });

  // Diversity: artist and remix spacing, and long runs of one primary style.
  const spacing = req.preferences.artistSpacing;
  let artistViolations = 0;
  let remixViolations = 0;
  for (let i = 0; i < known.length; i++) {
    const a = ctx.track(known[i]!);
    const aTokens = artistTokens(a.artist);
    for (let j = i + 1; j <= Math.min(known.length - 1, i + spacing); j++) {
      const b = ctx.track(known[j]!);
      if (a.id === b.id) continue;
      const bTokens = new Set(artistTokens(b.artist));
      if (aTokens.some((t) => bTokens.has(t))) artistViolations++;
      if (a.remixGroup && a.remixGroup.toLowerCase() === b.remixGroup.toLowerCase()) remixViolations++;
    }
  }
  let longestRun = 0;
  let run = 0;
  let runExcess = 0;
  let prevStyle: string | null = null;
  const styles = new Set<string>();
  for (const id of known) {
    const t = ctx.track(id);
    t.styleTags.forEach((s) => styles.add(s));
    const primary = t.styleTags[0]?.toLowerCase() ?? null;
    run = primary !== null && primary === prevStyle ? run + 1 : 1;
    if (primary !== null && run > 4) runExcess++;
    longestRun = Math.max(longestRun, primary === null ? 0 : run);
    prevStyle = primary;
  }
  const diversityCost = Math.min(
    1,
    (3 * (artistViolations + remixViolations + 0.5 * runExcess)) / Math.max(1, known.length - 1),
  );

  // Duration accounting from played spans and overlaps.
  const target = ctx.targetDurationSeconds();
  let durationError: number | null = null;
  let durationCost = 0;
  if (target) {
    durationError = totalSeconds < target.min ? target.min - totalSeconds : totalSeconds > target.max ? totalSeconds - target.max : 0;
    if (durationError > 0) {
      const mid = (target.min + target.max) / 2;
      durationCost = 1 + (3 * durationError) / Math.max(60, mid);
      violations.push({
        code: "duration",
        message: `Planned playback is ${Math.round(totalSeconds / 60)} min; target is ${target.min / 60} to ${target.max / 60} min`,
      });
    }
  }

  const hardCount = violations.filter((v) => v.code !== "duration").length;
  const objective: ObjectiveBreakdown = {
    meanTransition: weights.meanTransition * mean,
    worstTransition: weights.worstTransition * worst,
    arc: weights.arc * arcCost,
    diversity: weights.diversity * diversityCost,
    duration: durationCost,
    hardPenalty: HARD_PENALTY * hardCount,
    total: 0,
  };
  objective.total =
    objective.meanTransition +
    objective.worstTransition +
    objective.arc +
    objective.diversity +
    objective.duration +
    objective.hardPenalty;

  const uniqueTracks = [...new Set(known)].map((id) => ctx.track(id));
  const metrics: PlanMetrics = {
    trackCount: known.length,
    totalSeconds,
    transitionCost: { mean, median: median(costs), worst, worstIndex },
    reviewNeededShare: path.transitions.length
      ? path.transitions.filter((t) => t.reviewNeeded).length / path.transitions.length
      : 0,
    arc: { rmse: arcRmse, coverage: arcCoverage, available: ctx.arc !== null },
    diversity: {
      artistViolations,
      remixViolations,
      styleCoverage: [...styles].sort(),
      longestStyleRun: longestRun,
    },
    durationErrorSeconds: durationError,
    missingEvidence: {
      key: uniqueTracks.filter((t) => usableKey(t.keyTonic, t.keyMode, t.keyStatus) === null).length,
      tempo: uniqueTracks.filter((t) => t.bpm === null).length,
      energy: uniqueTracks.filter((t) => t.energy === null).length,
      reviewedCues: items.filter((it) => it.entryOrigin === "reviewed" || it.entryOrigin === "full_track").length,
    },
  };

  return { label, items, transitions: path.transitions, metrics, violations, objective };
}

function emptyMetrics(): PlanMetrics {
  return {
    trackCount: 0,
    totalSeconds: 0,
    transitionCost: { mean: 0, median: 0, worst: 0, worstIndex: null },
    reviewNeededShare: 0,
    arc: { rmse: null, coverage: 0, available: false },
    diversity: { artistViolations: 0, remixViolations: 0, styleCoverage: [], longestStyleRun: 0 },
    durationErrorSeconds: null,
    missingEvidence: { key: 0, tempo: 0, energy: 0, reviewedCues: 0 },
  };
}
