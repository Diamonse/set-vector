/**
 * The CLI analyzer versions this browser port reproduces. `tests/analysis/cli-drift.test.ts`
 * fails when `src/setvector/analysis/identity.py` moves past them, so a change to the
 * Python analyzer cannot leave the web app silently behind.
 */
export const PORTED_FROM = {
  baselineExtractor: "baseline-v1",
  baselineAlgorithmVersion: 3,
  rhythmExtractor: "rhythm-v1",
  rhythmAlgorithmVersion: 1,
} as const;
