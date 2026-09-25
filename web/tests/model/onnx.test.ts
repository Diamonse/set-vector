import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { describe, expect, it } from "vitest";
import { frameLogits, logMel, pickPeaks } from "@/lib/analysis/beat-model";
import { createOnnxRunner, type OrtLike } from "@/lib/analysis/onnx-runner";
import { club } from "../analysis/signals";

const modelPath = process.env.BEAT_MODEL_PATH;
const referencePath = process.env.BEAT_MODEL_REFERENCE;

describe("Beat This! through ONNX Runtime Web matches PyTorch frame_logits", () => {
  it("has its inputs", () => {
    expect(modelPath, "set BEAT_MODEL_PATH to an exported .onnx file").toBeTruthy();
    expect(referencePath, "set BEAT_MODEL_REFERENCE to make_model_reference.py output").toBeTruthy();
  });

  it("reproduces logits and peaks", async () => {
    const reference = JSON.parse(readFileSync(referencePath!, "utf8")) as {
      seconds: number;
      frames: number;
      beat: number[];
      downbeat: number[];
      beats: number[];
      downbeats: number[];
    };
    ort.env.wasm.numThreads = 1;
    const runner = await createOnnxRunner(ort as unknown as OrtLike, new Uint8Array(readFileSync(modelPath!)));
    const spect = logMel(club(22050, reference.seconds, 124), 22050);
    expect(spect.frames).toBe(reference.frames);
    const logits = await frameLogits(spect, runner);
    let worst = 0;
    for (let f = 0; f < reference.frames; f++) {
      worst = Math.max(worst, Math.abs(logits.beat[f]! - reference.beat[f]!), Math.abs(logits.downbeat[f]! - reference.downbeat[f]!));
    }
    // The spectrogram differs from PyTorch's float32 STFT by up to ~2e-3, which the network
    // carries into the logits. Peaks are compared where the reference peak is clear of the
    // 0 threshold. Random weights give noisy logits with several near-equal maxima inside
    // the ±3-frame window, so a few clear peaks still move; 95% is the random-weight bound.
    console.log(`max logit difference ${worst.toExponential(2)}`);
    expect(worst).toBeLessThan(5e-2);
    const peaks = pickPeaks(logits.beat, logits.downbeat);
    const clear = reference.beats.filter((t) => reference.beat[Math.round(t * 50)]! >= 0.1);
    const found = clear.filter((t) => peaks.beats.some((b) => Math.abs(b - t) <= 0.021)).length;
    expect(clear.length).toBeGreaterThan(20);
    console.log(`clear peaks found ${found} of ${clear.length}`);
    expect(found / clear.length).toBeGreaterThan(0.95);
  });
});
