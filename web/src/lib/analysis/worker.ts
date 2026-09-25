/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { analyzeAudio } from "./analyze";
import type { BeatRunner } from "./beat-model";
import { loadBeatModel } from "./model-loader";
import { createOnnxRunner, type OrtLike } from "./onnx-runner";
import type { WorkerRequest, WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

ort.env.wasm.wasmPaths = "/ort/";
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let modelPromise: Promise<{ runner: BeatRunner; name: string; sha256: string } | { error: string } | null> | null = null;

function model(manifestUrl: string, pinned?: string) {
  modelPromise ??= loadBeatModel(manifestUrl, pinned)
    .then(async (loaded) => {
      if (!loaded) return null;
      const runner = await createOnnxRunner(ort as unknown as OrtLike, loaded.bytes);
      return { runner, name: loaded.manifest.name, sha256: loaded.manifest.sha256 };
    })
    .catch((error: Error) => ({ error: error.message }));
  return modelPromise;
}

const post = (message: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "analyze") return;
  try {
    post({ type: "progress", id: request.id, progress: { stage: "features", fraction: 0 }, note: "Loading the beat model" });
    const loaded = await model(request.modelManifestUrl, request.modelSha256);
    const warnings: string[] = [];
    let runner: BeatRunner | null = null;
    let info: { name: string; sha256: string } | null = null;
    if (loaded && "runner" in loaded) {
      runner = loaded.runner;
      info = { name: loaded.name, sha256: loaded.sha256 };
    } else if (loaded && "error" in loaded) {
      warnings.push(`the Beat This! model could not be loaded: ${loaded.error}`);
    }
    const result = await analyzeAudio({
      channels: request.channels,
      sampleRate: request.sampleRate,
      beatRunner: runner,
      model: info,
      onProgress: (progress) => post({ type: "progress", id: request.id, progress }),
    });
    result.warnings.unshift(...warnings);
    post({ type: "result", id: request.id, result });
  } catch (error) {
    post({ type: "error", id: request.id, message: (error as Error).message || "analysis failed" });
  }
};
