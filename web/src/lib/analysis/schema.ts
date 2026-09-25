import { z } from "zod";

/**
 * Server-side validation of an analysis posted by the browser. The browser is not trusted:
 * every field the server stores or applies is checked for type and range.
 */
const finite = z.number().finite();

const keyEstimate = z.object({
  tonic: z.number().int().min(0).max(11).nullable(),
  mode: z.enum(["major", "minor"]).nullable(),
  status: z.enum(["estimated", "uncertain"]),
  correlation: finite,
  margin: finite,
  voicedShare: finite,
  ranking: z.array(z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(["major", "minor"]), correlation: finite })).max(24),
  profile: z.string().max(40),
  reasons: z.array(z.string().max(300)).max(10),
});

export const analysisResultSchema = z.object({
  extractor: z.object({
    name: z.string().max(60),
    version: z.number().int().min(1),
    parameters: z.record(z.string().max(60), z.union([z.string().max(120), finite, z.boolean()])),
    model: z.object({ name: z.string().max(80), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).nullable(),
  }),
  durationSeconds: finite.positive().max(86400),
  sampleRate: z.number().int().min(8000).max(384000),
  channelCount: z.number().int().min(1).max(32),
  tempo: z.object({
    bpm: finite.min(20).max(400).nullable(),
    source: z.enum(["beat_this_grid", "fallback_grid", "tempogram", "none"]),
    candidates: z.array(z.object({ bpm: finite, strength: finite, relation: z.enum(["primary", "double", "half", "peak"]) })).max(10),
    alternatives: z.array(finite.min(40).max(250)).max(4),
  }),
  rhythm: z.object({
    chosen: z.enum(["beat_this", "setvector_fallback"]).nullable(),
    modelAvailable: z.boolean(),
    reasons: z.array(z.string().max(300)).max(20),
    candidates: z.array(z.object({ name: z.string().max(40), quality: z.record(z.string(), finite.nullable()), reasons: z.array(z.string().max(300)).max(10) })).max(2),
    segments: z.array(z.object({ startSeconds: finite, period: finite.positive(), beatCount: z.number().int().min(1) })).max(8),
    beats: z.array(finite.min(0)).max(40000),
    downbeats: z.array(finite.min(0)).max(10000),
  }),
  key: keyEstimate,
  regionKeys: z.array(z.object({ kind: z.enum(["entry", "exit"]), startSeconds: finite, endSeconds: finite, key: keyEstimate })).max(10),
  loudness: z.object({
    integratedLufs: finite.nullable(),
    loudnessRangeLu: finite.nullable(),
    samplePeakDbfs: finite.nullable(),
    shortTerm: z.array(finite.nullable()).max(90000),
  }),
  summary: z.object({ meanRms: finite, meanCentroidHz: finite.nullable(), meanBassRatio: finite.nullable() }),
  boundaries: z.array(z.object({ seconds: finite, strength: finite })).max(500),
  cues: z
    .array(z.object({ kind: z.enum(["entry", "exit"]), startSeconds: finite.min(0), endSeconds: finite.positive(), label: z.string().max(120) }))
    .max(10),
  waveform: z.object({ buckets: z.number().int().min(1).max(4000), secondsPerBucket: finite.positive(), peaks: z.array(finite.min(0).max(1)).max(4000) }),
  warnings: z.array(z.string().max(400)).max(20),
});

export type ValidatedAnalysis = z.infer<typeof analysisResultSchema>;

export const saveAnalysisSchema = z.object({
  assetId: z.string().regex(/^[0-9a-f]{64}$/),
  fileName: z.string().max(400),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().max(300),
  /** Existing track to update; null to match by asset ID or create a new track. */
  trackId: z.uuid().nullable(),
  result: analysisResultSchema,
});

export type SaveAnalysisInput = z.infer<typeof saveAnalysisSchema>;
