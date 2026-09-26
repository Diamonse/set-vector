import type { CandidateQuality, Segment } from "./grid";
import type { CueSuggestion, Boundary } from "./structure";
import type { KeyEstimate } from "./key";
import type { TempoCandidate } from "./tempo";

export const EXTRACTOR_NAME = "web-analysis";
export const EXTRACTOR_VERSION = 1;

export interface ExtractorInfo {
  name: string;
  version: number;
  parameters: Record<string, string | number | boolean>;
  model: { name: string; sha256: string } | null;
}

export interface KeyRegionEstimate {
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
  key: KeyEstimate;
}

/** Everything the browser measures for one file. JSON-serializable. */
export interface AnalysisResult {
  extractor: ExtractorInfo;
  durationSeconds: number;
  sampleRate: number;
  channelCount: number;
  tempo: {
    bpm: number | null;
    source: "beat_this_grid" | "fallback_grid" | "tempogram" | "none";
    candidates: TempoCandidate[];
    /** Plausible other tactus rates for the planner, in BPM. */
    alternatives: number[];
  };
  rhythm: {
    chosen: "beat_this" | "setvector_fallback" | null;
    modelAvailable: boolean;
    reasons: string[];
    candidates: { name: string; quality: CandidateQuality; reasons: string[] }[];
    segments: Segment[];
    beats: number[];
    /** Grid beats that start a bar; empty unless the model's downbeats were reliable. */
    downbeats: number[];
  };
  key: KeyEstimate;
  regionKeys: KeyRegionEstimate[];
  loudness: {
    integratedLufs: number | null;
    loudnessRangeLu: number | null;
    samplePeakDbfs: number | null;
    shortTerm: (number | null)[];
  };
  summary: { meanRms: number; meanCentroidHz: number | null; meanBassRatio: number | null };
  boundaries: Boundary[];
  cues: CueSuggestion[];
  /** Peak absolute amplitude per bucket, 0 to 1, for drawing a waveform. */
  waveform: { buckets: number; secondsPerBucket: number; peaks: number[] };
  warnings: string[];
}

export type AnalysisStage = "features" | "tempo" | "beats" | "key" | "loudness" | "structure" | "done";

export interface AnalysisProgress {
  stage: AnalysisStage;
  fraction: number;
}
