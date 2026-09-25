import { describe, expect, it } from "vitest";
import {
  defaultPlanRequest,
  evaluateEditedOrder,
  evaluateTransition,
  matchTempo,
  planSet,
  PlanRequestError,
  type PlanRequest,
} from "@/lib/planner";
import { cueOptions } from "@/lib/planner/options";
import { cue, track } from "./fixtures";

function request(ids: string[], patch: Partial<PlanRequest> = {}): PlanRequest {
  const r = defaultPlanRequest("dj", ids);
  r.search.timeBudgetMs = 400;
  return { ...r, ...patch };
}

describe("tempo matching", () => {
  it("prefers half/double time when closer", () => {
    const m = matchTempo(128, 64, []);
    expect(m.multiple).toBe(2);
    expect(Math.abs(m.adjustPct)).toBeLessThan(1e-9);
  });

  it("uses a stored alternative tactus", () => {
    const m = matchTempo(126, 90, [125]);
    expect(m.usedAlternative).toBe(true);
    expect(m.adjustPct).toBeCloseTo(0.8, 1);
  });
});

describe("directional transitions", () => {
  const ctx = { mode: "dj" as const, preferences: defaultPlanRequest("dj").preferences, weights: defaultPlanRequest("dj").weights.transition };

  it("suggests a blend for matching keys and tempo with reviewed cues", () => {
    const a = track("a");
    const b = track("b", { bpm: 125 });
    const t = evaluateTransition(a, cueOptions(a, "exit", "dj")[0]!, b, cueOptions(b, "entry", "dj")[0]!, ctx);
    expect(t.type).toBe("blend");
    expect(t.overlapSeconds).toBeGreaterThan(0);
    expect(t.reviewNeeded).toBe(false);
    expect(t.explanation).toContain("same Camelot key");
  });

  it("falls back to a cut beyond the tempo limit and flags missing keys", () => {
    const a = track("a");
    const b = track("b", { bpm: 100, keyTonic: null, keyMode: null, keyStatus: "unknown" });
    const t = evaluateTransition(a, cueOptions(a, "exit", "dj")[0]!, b, cueOptions(b, "entry", "dj")[0]!, ctx);
    expect(t.type).toBe("cut");
    expect(t.components.harmonic.status).toBe("missing");
    expect(t.explanation).toContain("key unavailable");
  });

  it("flags vocal overlap", () => {
    const a = track("a", { cues: [cue("entry", 0, 30), cue("exit", 240, 300, { vocalActivity: "present" })] });
    const b = track("b", { cues: [cue("entry", 0, 30, { vocalActivity: "present" }), cue("exit", 250, 300)] });
    const t = evaluateTransition(a, cueOptions(a, "exit", "dj")[0]!, b, cueOptions(b, "entry", "dj")[0]!, ctx);
    expect(t.type).toBe("short_blend");
    expect(t.reviewNeeded).toBe(true);
    expect(t.reasons).toContain("vocal overlap risk");
  });

  it("is directional", () => {
    const a = track("a", { energy: 3 });
    const b = track("b", { energy: 8, cues: [cue("entry", 0, 30, { provenance: "estimate" }), cue("exit", 250, 300)] });
    const ab = evaluateTransition(a, cueOptions(a, "exit", "dj")[0]!, b, cueOptions(b, "entry", "dj")[0]!, ctx);
    const ba = evaluateTransition(b, cueOptions(b, "exit", "dj")[0]!, a, cueOptions(a, "entry", "dj")[0]!, ctx);
    expect(ab.cost).not.toBeCloseTo(ba.cost, 6);
  });
});

describe("planSet", () => {
  const library = [
    track("t1", { energy: 3, keyTonic: 9, bpm: 120, artist: "Alpha" }),
    track("t2", { energy: 5, keyTonic: 4, bpm: 122, artist: "Beta" }),
    track("t3", { energy: 7, keyTonic: 11, bpm: 124, artist: "Gamma" }),
    track("t4", { energy: 9, keyTonic: 6, bpm: 126, artist: "Delta" }),
    track("t5", { energy: 6, keyTonic: 9, bpm: 125, artist: "Epsilon", styleTags: ["Bollywood", "BollyHouse"] }),
    track("t6", { energy: 4, keyTonic: 2, bpm: 90, artist: "Zeta", styleTags: ["Hip-hop"], cues: [] }),
  ];
  const ids = library.map((t) => t.id);

  it("reorders a fixed crate using every track once", () => {
    const result = planSet(library, request(ids));
    const order = result.proposal.items.map((i) => i.trackId);
    expect(order.slice().sort()).toEqual(ids.slice().sort());
    expect(result.proposal.violations).toEqual([]);
    expect(result.proposal.transitions).toHaveLength(ids.length - 1);
    expect(result.baselines.map((b) => b.kind)).toEqual(["random", "bpm_sort", "camelot", "greedy"]);
    expect(result.exact).not.toBeNull();
    expect(result.exact!.gap).toBeGreaterThanOrEqual(0);
  });

  it("does not beat the exact optimum and stays near it on a small crate", () => {
    const result = planSet(library, request(ids));
    expect(result.proposal.objective.total).toBeGreaterThanOrEqual(result.exact!.objective - 1e-9);
    expect(result.exact!.gap).toBeLessThan(0.25);
  });

  it("honors anchors", () => {
    const result = planSet(library, request(ids, { startTrackId: "t4", endTrackId: "t1" }));
    const order = result.proposal.items.map((i) => i.trackId);
    expect(order[0]).toBe("t4");
    expect(order[order.length - 1]).toBe("t1");
  });

  it("selects from a pool with required and excluded tracks", () => {
    const result = planSet(
      library,
      request(ids, { selectionPolicy: "choose_from_pool", targetCount: 4, requiredTrackIds: ["t6"], excludedTrackIds: ["t3"] }),
    );
    const order = result.proposal.items.map((i) => i.trackId);
    expect(order).toHaveLength(4);
    expect(order).toContain("t6");
    expect(order).not.toContain("t3");
    expect(new Set(order).size).toBe(4);
  });

  it("accounts DJ duration by played spans, and listening duration by whole tracks", () => {
    const dj = planSet(library, request(ids));
    const listening = planSet(library, { ...defaultPlanRequest("listening", ids), search: { ...defaultPlanRequest("listening").search, timeBudgetMs: 300 } });
    const fullLength = library.reduce((s, t) => s + t.durationSeconds, 0);
    expect(listening.proposal.metrics.totalSeconds).toBeCloseTo(fullLength, 6);
    expect(dj.proposal.metrics.totalSeconds).toBeLessThan(fullLength);
    const items = dj.proposal.items;
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.elapsedStartSeconds).toBeGreaterThan(items[i - 1]!.elapsedStartSeconds);
    }
  });

  it("assigns cues jointly so every middle track keeps a valid played span", () => {
    const tricky = [
      track("x1"),
      track("x2", { cues: [cue("entry", 0, 20), cue("entry", 200, 230), cue("exit", 150, 190), cue("exit", 260, 300)] }),
      track("x3"),
    ];
    const r = { ...request(["x1", "x2", "x3"]), startTrackId: "x1", endTrackId: "x3" };
    const plan = planSet(tricky, r).proposal;
    const middle = plan.items[1]!;
    expect(middle.playEndSeconds - middle.playStartSeconds).toBeGreaterThanOrEqual(60);
    expect(plan.violations.filter((v) => v.code === "cue_conflict")).toEqual([]);
  });

  it("rejects contradictory requests", () => {
    expect(() => planSet(library, request(ids, { requiredTrackIds: ["t1"], excludedTrackIds: ["t1"] }))).toThrow(PlanRequestError);
    expect(() => planSet(library, request(ids, { selectionPolicy: "choose_from_pool" }))).toThrow(/count or duration/);
  });

  it("reports violations for an edited order", () => {
    const r = request(ids, { startTrackId: "t1" });
    const edited = evaluateEditedOrder(library, r, ["t2", "t1", "t3", "t4", "t5", "t6"]);
    expect(edited.violations.map((v) => v.code)).toContain("start_anchor");
  });

  it("is deterministic for the same seed", () => {
    const a = planSet(library, request(ids)).proposal.items.map((i) => i.trackId);
    const b = planSet(library, request(ids)).proposal.items.map((i) => i.trackId);
    expect(a).toEqual(b);
  });
});
