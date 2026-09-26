import { describe, expect, it } from "vitest";
import { fittingCues, planTrackUpdate, type TrackEvidence } from "@/lib/analysis/apply";
import { analysisResultSchema, type ValidatedAnalysis } from "@/lib/analysis/schema";
import { analyzeAudio } from "@/lib/analysis/analyze";
import { club } from "./signals";

let result: ValidatedAnalysis;

const fresh: TrackEvidence = { durationSeconds: 60, bpm: null, bpmSource: null, keyTonic: null, keyMode: null, keyStatus: "unknown" };

describe("applying an analysis", () => {
  it("produces a result the server schema accepts", async () => {
    const raw = await analyzeAudio({ channels: [club(22050, 60, 124)], sampleRate: 22050, beatRunner: null, model: null });
    result = analysisResultSchema.parse(JSON.parse(JSON.stringify(raw)));
  }, 60_000);

  it("fills missing values as estimates", () => {
    const plan = planTrackUpdate(fresh, result);
    expect(plan.patch.bpm_source).toBe("estimate");
    expect(plan.patch.key_tonic).toBe(9);
    expect(plan.patch.key_status).toBe(result.key.status);
    expect(plan.applied).toContain("tempo");
  });

  it("never overwrites reviewed values", () => {
    const plan = planTrackUpdate({ ...fresh, bpm: 123, bpmSource: "reviewed", keyTonic: 0, keyMode: "major", keyStatus: "reviewed" }, result);
    expect(plan.patch).toEqual({});
    expect(plan.kept).toEqual(["tempo (reviewed)", "key (reviewed)"]);
  });

  it("keeps a key marked not meaningful", () => {
    expect(planTrackUpdate({ ...fresh, keyStatus: "not_meaningful" }, result).patch.key_status).toBeUndefined();
  });

  it("replaces earlier estimates", () => {
    const plan = planTrackUpdate({ ...fresh, bpm: 100, bpmSource: "estimate", keyTonic: 2, keyMode: "major", keyStatus: "estimated" }, result);
    expect(plan.patch.bpm).toBeCloseTo(124, 0);
    expect(plan.patch.key_tonic).toBe(9);
  });

  it("warns when the stored duration does not match the audio and drops cues past it", () => {
    const plan = planTrackUpdate({ ...fresh, durationSeconds: 30 }, result);
    expect(plan.warnings[0]).toMatch(/same file/);
    expect(fittingCues(result, 30).every((c) => c.endSeconds <= 30)).toBe(true);
  });

  it("rejects tampered results", () => {
    const bad = JSON.parse(JSON.stringify(result));
    bad.tempo.bpm = 9999;
    expect(analysisResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("re-analysis", () => {
  it("does not re-suggest a region the user already approved or rejected", async () => {
    const raw = await analyzeAudio({ channels: [club(22050, 60, 124)], sampleRate: 22050, beatRunner: null, model: null });
    const r = analysisResultSchema.parse(JSON.parse(JSON.stringify(raw)));
    const exit = r.cues.find((c) => c.kind === "exit")!;
    const kept = fittingCues(r, 60, [{ kind: "exit", startSeconds: exit.startSeconds + 0.1, endSeconds: exit.endSeconds - 0.1 }]);
    expect(kept.map((c) => c.kind)).toEqual(["entry"]);
  }, 60_000);
});
