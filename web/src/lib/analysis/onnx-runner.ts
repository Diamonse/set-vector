import type { BeatRunner } from "./beat-model";
import { N_MELS } from "./beat-model";

/** The subset of the ONNX Runtime API the runner uses, so browser and Node builds both fit. */
export interface OrtLike {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(model: Uint8Array, options?: Record<string, unknown>): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
    }>;
  };
}

/** Builds a `BeatRunner` over an exported Beat This! model (input `spect`, outputs `beat`, `downbeat`). */
export async function createOnnxRunner(ort: OrtLike, model: Uint8Array): Promise<BeatRunner> {
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return async (chunk, frames) => {
    const outputs = await session.run({ spect: new ort.Tensor("float32", chunk, [1, frames, N_MELS]) });
    return { beat: outputs.beat!.data as Float32Array, downbeat: outputs.downbeat!.data as Float32Array };
  };
}
