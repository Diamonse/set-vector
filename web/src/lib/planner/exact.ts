import { evaluateSequence, type PlanningContext } from "./evaluate";

export const EXACT_LIMIT = 8;

/**
 * Exhaustive ordering search for small fixed crates, used to measure the
 * heuristic's optimizer gap. Anchored positions stay fixed.
 */
export function exactOrder(ctx: PlanningContext, ids: string[], deadline: number): { best: string[]; objective: number; permutations: number } | null {
  if (ids.length > EXACT_LIMIT || ids.length === 0) return null;
  const req = ctx.request;
  const start = req.startTrackId && ids.includes(req.startTrackId) ? req.startTrackId : null;
  const end = req.endTrackId && ids.includes(req.endTrackId) && req.endTrackId !== start ? req.endTrackId : null;
  const free = ids.filter((id) => id !== start && id !== end);

  let best: string[] | null = null;
  let bestObjective = Infinity;
  let permutations = 0;
  let timedOut = false;

  const visit = (perm: string[]) => {
    const seq = [...(start ? [start] : []), ...perm, ...(end ? [end] : [])];
    const e = evaluateSequence(ctx, seq, "Exact");
    permutations++;
    if (e.objective.total < bestObjective) {
      bestObjective = e.objective.total;
      best = seq;
    }
  };

  // Heap's algorithm, iterative.
  const a = free.slice();
  const c = new Array(a.length).fill(0);
  visit(a.slice());
  let i = 1;
  while (i < a.length) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [a[k], a[i]] = [a[i]!, a[k]!];
      visit(a.slice());
      c[i]++;
      i = 1;
    } else {
      c[i] = 0;
      i++;
    }
  }
  if (timedOut || best === null) return null;
  return { best, objective: bestObjective, permutations };
}
