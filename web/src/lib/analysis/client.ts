"use client";

import { assetId, sniffSampleRate, tagsFor, type FileTags } from "./metadata";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { AnalysisProgress, AnalysisResult } from "./types";

export const MODEL_MANIFEST_URL = process.env.NEXT_PUBLIC_BEAT_MODEL_MANIFEST_URL || "/models/beat_this-final0.json";
const MODEL_SHA256 = process.env.NEXT_PUBLIC_BEAT_MODEL_SHA256 || undefined;

export interface AnalyzedFile {
  fileName: string;
  assetId: string;
  tags: FileTags;
  result: AnalysisResult;
}

export type ClientProgress = AnalysisProgress | { stage: "hashing" | "decoding"; fraction: number };

/**
 * Decodes an audio file to per-channel samples. The decoder resamples to its context's
 * rate, so the context is opened at the file's native rate when the header reveals it.
 */
export async function decodeFile(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const native = sniffSampleRate(bytes);
  let context: AudioContext;
  try {
    context = native ? new AudioContext({ sampleRate: native }) : new AudioContext();
  } catch {
    context = new AudioContext();
  }
  try {
    // decodeAudioData detaches its input, so give it a copy.
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
    return { channels, sampleRate: buffer.sampleRate };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Runs analyses one at a time in a dedicated worker. */
export class AnalysisClient {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void; progress: (p: ClientProgress) => void }>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if (message.type === "progress") entry.progress(message.progress);
      else {
        this.pending.delete(message.id);
        if (message.type === "result") entry.resolve(message.result);
        else entry.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      for (const entry of this.pending.values()) entry.reject(new Error(event.message || "the analysis worker stopped"));
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  async analyzeFile(file: File, onProgress: (p: ClientProgress) => void): Promise<AnalyzedFile> {
    onProgress({ stage: "hashing", fraction: 0 });
    const bytes = await file.arrayBuffer();
    const id = await assetId(bytes);
    const tags = tagsFor(file.name, bytes);
    onProgress({ stage: "decoding", fraction: 0 });
    const { channels, sampleRate } = await decodeFile(bytes);
    const worker = this.ensureWorker();
    const requestId = crypto.randomUUID();
    const result = await new Promise<AnalysisResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, progress: onProgress });
      const request: WorkerRequest = {
        type: "analyze",
        id: requestId,
        channels,
        sampleRate,
        modelManifestUrl: new URL(MODEL_MANIFEST_URL, window.location.href).toString(),
        modelSha256: MODEL_SHA256,
      };
      worker.postMessage(request, channels.map((c) => c.buffer));
    });
    return { fileName: file.name, assetId: id, tags, result };
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
