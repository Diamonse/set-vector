import { targetEnergyAt } from "./arc";
import { evaluateSequence, type PlanningContext } from "./evaluate";
import type { EvaluatedPlan } from "./types";

export interface SearchSetup {
  ctx: PlanningContext;
  /** Tracks the search may place, after exclusions and pruning. */
  pool: string[];
  targetCount: number;
  deadline: number;
}

interface BeamState {
  seq: string[];
  score: number;
  elapsed: number;
}

function artistKey(artist: string): string[] {
  return artist
    .toLowerCase()
    .split(/,|&|\bfeat\.?|\bft\.?|\bx\b|\/|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Positions whose track is fixed by a start or end anchor. */
function lockedPositions(setup: SearchSetup, length: number): Set<number> {
  const locked = new Set<number>();
  if (setup.ctx.request.startTrackId) locked.add(0);
  if (setup.ctx.request.endTrackId) locked.add(length - 1);
  return locked;
}

function canPlace(setup: SearchSetup, seq: string[], id: string): boolean {
  const { repeatPolicy } = setup.ctx.request;
  const last = seq.lastIndexOf(id);
  if (last === -1) return true;
  if (!repeatPolicy.allowRepeats) return false;
  return seq.length - last - 1 >= repeatPolicy.minGapTracks;
}

/** Incremental score of appending one track: guide transition cost, arc fit, and spacing. */
function stepScore(setup: SearchSetup, state: BeamState, id: string, estimatedTotal: number): number {
  const { ctx } = setup;
  const w = ctx.request.weights;
  let score = 0;
  const prev = state.seq[state.seq.length - 1];
  if (prev !== undefined) score += w.meanTransition * ctx.bestPairCost(prev, id);

  if (ctx.arc) {
    const played = ctx.typicalPlayed(id);
    const u = (state.elapsed + played / 2) / Math.max(1, estimatedTotal);
    const energy = ctx.track(id).energy;
    score += w.arc * (energy === null ? 0.15 : Math.abs(energy - targetEnergyAt(ctx.arc, u)) / 9);
  }

  const spacing = ctx.request.preferences.artistSpacing;
  if (spacing > 0) {
    const tokens = artistKey(ctx.track(id).artist);
    const group = ctx.track(id).remixGroup.toLowerCase();
    for (const other of state.seq.slice(-spacing)) {
      const t = ctx.track(other);
      if (tokens.some((k) => artistKey(t.artist).includes(k))) score += w.diversity * 0.5;
      if (group && group === t.remixGroup.toLowerCase()) score += w.diversity * 0.5;
    }
  }
  return score;
}

/**
 * Multi-start beam search. Hard constraints shape the frontier: anchors are
 * fixed, excluded tracks never enter the pool, and a state is pruned when the
 * remaining slots cannot hold the still-missing required tracks.
 */
export function beamSearch(setup: SearchSetup): string[][] {
  const { ctx, pool, targetCount } = setup;
  const req = ctx.request;
  const beamWidth = Math.max(1, req.search.beamWidth);
  const branch = Math.max(1, req.search.branchFactor);
  const required = new Set(req.requiredTrackIds.filter((id) => pool.includes(id)));
  const endId = req.endTrackId;
  if (endId) required.delete(endId);
  const startId = req.startTrackId;
  if (startId) required.delete(startId);

  const avgPlayed = pool.reduce((s, id) => s + ctx.typicalPlayed(id), 0) / Math.max(1, pool.length);
  const target = ctx.targetDurationSeconds();
  const estimatedTotal = target ? (target.min + target.max) / 2 : avgPlayed * targetCount;

  // Starting states.
  let beam: BeamState[];
  if (startId) {
    beam = [{ seq: [startId], score: stepScore(setup, { seq: [], score: 0, elapsed: 0 }, startId, estimatedTotal), elapsed: ctx.typicalPlayed(startId) }];
  } else {
    const empty: BeamState = { seq: [], score: 0, elapsed: 0 };
    beam = pool
      .filter((id) => id !== endId || targetCount === 1)
      .map((id) => ({ seq: [id], score: stepScore(setup, empty, id, estimatedTotal), elapsed: ctx.typicalPlayed(id) }))
      .sort((a, b) => a.score - b.score || a.seq[0]!.localeCompare(b.seq[0]!))
      .slice(0, beamWidth);
  }

  for (let length = 1; length < targetCount; length++) {
    const isLast = length === targetCount - 1;
    const next: BeamState[] = [];
    const seen = new Set<string>();
    for (const state of beam) {
      const placedRequired = state.seq.filter((id) => required.has(id));
      const missingRequired = required.size - new Set(placedRequired).size;
      const slotsAfter = targetCount - length - 1 - (endId && !isLast ? 1 : 0);

      let options: string[];
      if (isLast && endId) {
        options = canPlace(setup, state.seq, endId) ? [endId] : [];
      } else {
        options = pool.filter((id) => id !== endId && id !== startId && canPlace(setup, state.seq, id));
        if (missingRequired > slotsAfter) {
          options = options.filter((id) => required.has(id) && !state.seq.includes(id));
        }
      }

      const scored = options
        .map((id) => ({ id, score: stepScore(setup, state, id, estimatedTotal) }))
        .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
        .slice(0, branch);
      for (const option of scored) {
        const seq = [...state.seq, option.id];
        const key = seq.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ seq, score: state.score + option.score, elapsed: state.elapsed + ctx.typicalPlayed(option.id) });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => a.score - b.score || a.seq.join().localeCompare(b.seq.join()));
    beam = next.slice(0, beamWidth);
    if (Date.now() > setup.deadline) {
      // Out of time: finish each state greedily so the result stays complete.
      beam = beam.map((s) => completeGreedily(setup, s, targetCount, estimatedTotal));
      break;
    }
  }
  return beam.map((s) => s.seq);
}

function completeGreedily(setup: SearchSetup, state: BeamState, targetCount: number, estimatedTotal: number): BeamState {
  const { ctx, pool } = setup;
  const req = ctx.request;
  let current = state;
  while (current.seq.length < targetCount) {
    const isLast = current.seq.length === targetCount - 1;
    const options =
      isLast && req.endTrackId
        ? [req.endTrackId]
        : pool.filter((id) => id !== req.endTrackId && id !== req.startTrackId && canPlace(setup, current.seq, id));
    if (options.length === 0) break;
    let best = options[0]!;
    let bestScore = Infinity;
    for (const id of options) {
      const s = stepScore(setup, current, id, estimatedTotal);
      if (s < bestScore) {
        bestScore = s;
        best = id;
      }
    }
    current = { seq: [...current.seq, best], score: current.score + bestScore, elapsed: current.elapsed + ctx.typicalPlayed(best) };
  }
  return current;
}

/**
 * Local improvement with swap, relocate (insert), and, for pool selection,
 * replace, add, and remove moves. Every changed directed edge is re-evaluated
 * through the full objective, including joint cue assignment.
 */
export function improve(setup: SearchSetup, initial: string[], label: string, deadline: number): EvaluatedPlan {
  const { ctx } = setup;
  const req = ctx.request;
  const poolMode = req.selectionPolicy === "choose_from_pool";
  const durationMode = poolMode && req.targetDuration !== null;
  const required = new Set(req.requiredTrackIds);

  let seq = initial.slice();
  let current = evaluateSequence(ctx, seq, label);

  const tryAccept = (candidate: string[]): boolean => {
    const evaluated = evaluateSequence(ctx, candidate, label);
    if (evaluated.objective.total < current.objective.total - 1e-9) {
      seq = candidate;
      current = evaluated;
      return true;
    }
    return false;
  };

  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    const locked = lockedPositions(setup, seq.length);
    const n = seq.length;

    // Swap two positions.
    for (let i = 0; i < n && Date.now() < deadline; i++) {
      if (locked.has(i)) continue;
      for (let j = i + 1; j < n; j++) {
        if (locked.has(j)) continue;
        const candidate = seq.slice();
        [candidate[i], candidate[j]] = [candidate[j]!, candidate[i]!];
        if (tryAccept(candidate)) improved = true;
      }
    }

    // Relocate one track to another position.
    for (let i = 0; i < seq.length && Date.now() < deadline; i++) {
      if (locked.has(i)) continue;
      for (let j = 0; j < seq.length; j++) {
        if (j === i || locked.has(j) || Math.abs(i - j) === 1) continue;
        const candidate = seq.slice();
        const [moved] = candidate.splice(i, 1);
        candidate.splice(j, 0, moved!);
        if (lockedPositions(setup, candidate.length).has(j)) continue;
        if (tryAccept(candidate)) improved = true;
      }
    }

    if (!poolMode) continue;

    // Replace an optional track with an unused candidate that fits its neighbors.
    for (let i = 0; i < seq.length && Date.now() < deadline; i++) {
      if (locked.has(i) || required.has(seq[i]!)) continue;
      const prev = seq[i - 1];
      const next = seq[i + 1];
      const used = new Set(seq);
      const options = setup.pool
        .filter((id) => !used.has(id) && id !== req.startTrackId && id !== req.endTrackId)
        .map((id) => ({
          id,
          guide: (prev ? ctx.bestPairCost(prev, id) : 0) + (next ? ctx.bestPairCost(id, next) : 0),
        }))
        .sort((a, b) => a.guide - b.guide || a.id.localeCompare(b.id))
        .slice(0, 8);
      for (const option of options) {
        const candidate = seq.slice();
        candidate[i] = option.id;
        if (tryAccept(candidate)) {
          improved = true;
          break;
        }
      }
    }

    if (!durationMode) continue;

    // Remove an optional track, or add an unused one, to meet a duration target.
    for (let i = 0; i < seq.length && Date.now() < deadline; i++) {
      if (lockedPositions(setup, seq.length).has(i) || required.has(seq[i]!) || seq.length <= 2) continue;
      const candidate = seq.slice();
      candidate.splice(i, 1);
      if (tryAccept(candidate)) improved = true;
    }
    const used = new Set(seq);
    const unused = setup.pool.filter((id) => !used.has(id) && id !== req.startTrackId && id !== req.endTrackId);
    for (let i = 1; i < seq.length && Date.now() < deadline; i++) {
      const prev = seq[i - 1]!;
      const next = seq[i]!;
      const options = unused
        .filter((id) => !seq.includes(id))
        .map((id) => ({ id, guide: ctx.bestPairCost(prev, id) + ctx.bestPairCost(id, next) }))
        .sort((a, b) => a.guide - b.guide || a.id.localeCompare(b.id))
        .slice(0, 4);
      for (const option of options) {
        const candidate = seq.slice();
        candidate.splice(i, 0, option.id);
        if (tryAccept(candidate)) {
          improved = true;
          break;
        }
      }
    }
  }
  return current;
}

/** Share of directed adjacent pairs two sequences have in common. */
export function sequenceSimilarity(a: string[], b: string[]): number {
  const pairs = (s: string[]) => new Set(s.slice(1).map((id, i) => `${s[i]}>${id}`));
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.size === 0 && pb.size === 0) return a.join() === b.join() ? 1 : 0;
  let shared = 0;
  pa.forEach((p) => {
    if (pb.has(p)) shared++;
  });
  return shared / Math.max(pa.size, pb.size);
}
