import { z } from "zod";
import type { PlanRequest } from "@/lib/planner";

const weight = z.number().min(0).max(10);

/** Validates a plan request posted from the client. Values are clamped to safe search budgets. */
export const planRequestSchema = z.object({
  mode: z.enum(["dj", "listening"]),
  selectionPolicy: z.enum(["use_all", "choose_from_pool"]),
  candidateTrackIds: z.array(z.uuid()).min(1, "Choose at least one track.").max(5000),
  targetCount: z.number().int().min(1).max(500).nullable(),
  targetDuration: z
    .object({ minMinutes: z.number().min(1).max(24 * 60), maxMinutes: z.number().min(1).max(24 * 60) })
    .nullable(),
  requiredTrackIds: z.array(z.uuid()).max(500),
  excludedTrackIds: z.array(z.uuid()).max(5000),
  startTrackId: z.uuid().nullable(),
  endTrackId: z.uuid().nullable(),
  repeatPolicy: z.object({ allowRepeats: z.boolean(), minGapTracks: z.number().int().min(0).max(200) }),
  energyArc: z.object({
    preset: z.enum(["none", "flat", "build", "peak", "wave", "cooldown", "opening", "custom"]),
    points: z.array(z.object({ t: z.number().min(0).max(1), energy: z.number().min(1).max(10) })).max(12),
  }),
  preferences: z.object({
    maxTempoAdjustPct: z.number().min(0).max(20),
    artistSpacing: z.number().int().min(0).max(20),
    keyLock: z.boolean(),
    transitionPreference: z.enum(["auto", "cut", "blend"]),
    minPlayedSeconds: z.number().min(0).max(600),
  }),
  weights: z.object({
    transition: z.object({
      harmonic: weight,
      tempo: weight,
      energyStep: weight,
      cue: weight,
      vocal: weight,
      style: weight,
    }),
    meanTransition: weight,
    worstTransition: weight,
    arc: weight,
    diversity: weight,
  }),
  search: z.object({
    beamWidth: z.number().int().min(1).max(64),
    branchFactor: z.number().int().min(1).max(64),
    maxCandidates: z.number().int().min(2).max(400),
    timeBudgetMs: z.number().int().min(200).max(10000),
    seed: z.number().int().min(0).max(2 ** 31 - 1),
    alternatives: z.number().int().min(0).max(4),
  }),
}) satisfies z.ZodType<PlanRequest>;

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Name the plan.").max(120),
  crateId: z.uuid().nullable(),
  request: planRequestSchema,
});
