import { compareKeys, usableKey } from "@/lib/domain/camelot";
import { evaluateSequence, type PlanningContext } from "./evaluate";
import { createRng, shuffle } from "./rng";
import type { BaselineResult, PlannerTrack } from "./types";

function greedyOrder(ctx: PlanningContext, ids: string[], cost: (a: string, b: string) => number): string[] {
  const req = ctx.request;
  const remaining = new Set(ids);
  const end = req.endTrackId && remaining.has(req.endTrackId) ? req.endTrackId : null;
  if (end) remaining.delete(end);

  let first: string;
  if (req.startTrackId && remaining.has(req.startTrackId)) first = req.startTrackId;
  else {
    // Without an anchor, open with the lowest annotated energy, then the first ID.
    first = [...remaining].sort((a, b) => {
      const ea = ctx.track(a).energy ?? 11;
      const eb = ctx.track(b).energy ?? 11;
      return ea - eb || a.localeCompare(b);
    })[0]!;
  }
  const order = [first];
  remaining.delete(first);
  while (remaining.size > 0) {
    const last = order[order.length - 1]!;
    let best: string | null = null;
    let bestCost = Infinity;
    for (const id of remaining) {
      const c = cost(last, id);
      if (c < bestCost || (c === bestCost && best !== null && id.localeCompare(best) < 0)) {
        bestCost = c;
        best = id;
      }
    }
    order.push(best!);
    remaining.delete(best!);
  }
  if (end) order.push(end);
  return order;
}

function harmonicCost(a: PlannerTrack, b: PlannerTrack): number {
  const ka = usableKey(a.keyTonic, a.keyMode, a.keyStatus);
  const kb = usableKey(b.keyTonic, b.keyMode, b.keyStatus);
  const tempo = a.bpm !== null && b.bpm !== null ? Math.abs(Math.log(a.bpm / b.bpm)) * 0.01 : 0.005;
  if (!ka || !kb) return 0.5 + tempo;
  return compareKeys(ka, kb).cost + tempo;
}

/**
 * Simple orderings of the same selected tracks under the same constraints.
 * Baselines that cannot satisfy an anchor are reported with their violations
 * rather than silently changing the task.
 */
export function runBaselines(ctx: PlanningContext, selected: string[], seed: number): BaselineResult[] {
  const unique = [...new Set(selected)];
  const random = shuffle(unique, createRng(seed ^ 0x9e3779b9));
  const bpmSorted = unique.slice().sort((a, b) => {
    const ba = ctx.track(a).bpm ?? Infinity;
    const bb = ctx.track(b).bpm ?? Infinity;
    return ba - bb || a.localeCompare(b);
  });
  const camelot = greedyOrder(ctx, unique, (a, b) => harmonicCost(ctx.track(a), ctx.track(b)));
  const greedy = greedyOrder(ctx, unique, (a, b) => ctx.bestPairCost(a, b));

  return [
    { kind: "random", label: "Random order", plan: evaluateSequence(ctx, random, "Random order") },
    { kind: "bpm_sort", label: "BPM ascending", plan: evaluateSequence(ctx, bpmSorted, "BPM ascending") },
    { kind: "camelot", label: "Camelot walk", plan: evaluateSequence(ctx, camelot, "Camelot walk") },
    { kind: "greedy", label: "Greedy nearest next", plan: evaluateSequence(ctx, greedy, "Greedy nearest next") },
  ];
}
