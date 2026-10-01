import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_DETECTION_SECONDS } from "@/lib/analysis/analyze";
import * as model from "@/lib/analysis/beat-model";
import { BASS_CUTOFF_HZ, BEAT_ONSET_BAND_HZ, DEFAULT_BASELINE_CONFIG } from "@/lib/analysis/features";
import * as grid from "@/lib/analysis/grid";
import { PORTED_FROM } from "@/lib/analysis/port";

/**
 * Guards the browser port against drift from the CLI analyzer it reproduces. These tests
 * read the Python sources in this repository; when one fails, port the CLI change to
 * `web/src/lib/analysis`, regenerate the parity fixtures (`npm run fixtures`), and then
 * update the expected value here and in `port.ts`.
 */

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

type PyValue = number | string | boolean | number[];

/** Module-level `NAME = literal` assignments: numbers, strings, booleans, and tuples of numbers. */
function pythonConstants(path: string): Record<string, PyValue> {
  const out: Record<string, PyValue> = {};
  for (const line of readFileSync(repo(path), "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const raw = m[2]!;
    const num = (s: string) => Number(s.replace(/_/g, ""));
    if (/^-?[\d_]+(\.[\d_]*)?$/.test(raw)) out[m[1]!] = num(raw);
    else if (raw === "True" || raw === "False") out[m[1]!] = raw === "True";
    else if (/^"[^"]*"$/.test(raw)) out[m[1]!] = raw.slice(1, -1);
    else if (/^\(([\d_.\s]+,)+[\d_.\s]*\)$/.test(raw)) {
      out[m[1]!] = raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).map(num);
    }
  }
  return out;
}

const identity = pythonConstants("src/setvector/analysis/identity.py");
const inference = pythonConstants("src/setvector/analysis/beat_this/_inference.py");
const beatThis = pythonConstants("src/setvector/analysis/beat_this/__init__.py");

function expectSame(cli: Record<string, PyValue>, name: string, web: PyValue, file: string) {
  expect(cli[name], `${name} is missing from ${file}; the CLI changed shape, so review the port`).toBeDefined();
  expect(web, `${name}: CLI ${file} has ${JSON.stringify(cli[name])}, the browser port has ${JSON.stringify(web)}`).toEqual(cli[name]);
}

describe("browser port matches the CLI analyzer", () => {
  it("is the same algorithm version", () => {
    expectSame(identity, "EXTRACTOR_NAME", PORTED_FROM.baselineExtractor, "identity.py");
    expectSame(identity, "ALGORITHM_VERSION", PORTED_FROM.baselineAlgorithmVersion, "identity.py");
    expectSame(identity, "RHYTHM_EXTRACTOR_NAME", PORTED_FROM.rhythmExtractor, "identity.py");
    expectSame(identity, "RHYTHM_ALGORITHM_VERSION", PORTED_FROM.rhythmAlgorithmVersion, "identity.py");
  });

  it("uses the same baseline parameters", () => {
    expectSame(identity, "BASS_CUTOFF_HZ", BASS_CUTOFF_HZ, "identity.py");
    expectSame(identity, "BEAT_ONSET_BAND_HZ", BEAT_ONSET_BAND_HZ, "identity.py");
    // The port's beat tracker never trims; it must match the CLI's setting.
    expectSame(identity, "BEAT_TRIM", false, "identity.py");
    const config = JSON.parse(readFileSync(repo("examples/analysis-config.json"), "utf8")) as { frame_length: number; hop_length: number };
    expect([DEFAULT_BASELINE_CONFIG.frameLength, DEFAULT_BASELINE_CONFIG.hopLength], "frame and hop lengths differ from examples/analysis-config.json").toEqual([
      config.frame_length,
      config.hop_length,
    ]);
  });

  it("uses the same grid fitting and acceptance thresholds", () => {
    for (const name of [
      "GRID_TOLERANCE_SECONDS",
      "GRID_ACCEPT_FRACTION",
      "GRID_MIN_SPLIT_BEATS",
      "GRID_MAX_SEGMENTS",
      "MIN_BEATS",
      "MAX_INTERVAL_CV",
      "INTERVAL_GAP_RATIO",
      "MIN_GRID_FIT",
      "MIN_BAR_REGULARITY",
      "BAR_LENGTHS",
      "BAR_PHASE_CONFIRM",
    ] as const) {
      expectSame(identity, name, grid[name] as PyValue, "identity.py");
    }
    expectSame(identity, "MIN_DETECTION_SECONDS", MIN_DETECTION_SECONDS, "identity.py");
  });

  it("uses the same Beat This! front end and post-processing", () => {
    expectSame(inference, "FPS", model.MODEL_FPS, "_inference.py");
    expectSame(beatThis, "FPS", model.MODEL_FPS, "beat_this/__init__.py");
    expectSame(inference, "SAMPLE_RATE", model.MODEL_SAMPLE_RATE, "_inference.py");
    for (const name of ["N_FFT", "HOP_LENGTH", "F_MIN", "F_MAX", "N_MELS", "CHUNK_FRAMES", "BORDER_FRAMES", "PEAK_WINDOW_FRAMES"] as const) {
      expectSame(inference, name, model[name], "_inference.py");
    }
  });
});
