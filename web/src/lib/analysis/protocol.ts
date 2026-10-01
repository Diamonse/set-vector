import type { AnalysisProgress, AnalysisResult } from "./types";

export type WorkerRequest = {
  type: "analyze";
  id: string;
  channels: Float32Array[];
  sampleRate: number;
  modelManifestUrl: string;
  modelSha256?: string;
};

export type WorkerResponse =
  | { type: "progress"; id: string; progress: AnalysisProgress; note?: string }
  | { type: "result"; id: string; result: AnalysisResult }
  | { type: "error"; id: string; message: string };
