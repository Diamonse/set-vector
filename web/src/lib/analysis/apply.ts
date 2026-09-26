import type { KeyStatus, MeasurementSource } from "@/lib/domain/types";
import type { ValidatedAnalysis } from "./schema";

/** The track fields analysis may fill, as stored. */
export interface TrackEvidence {
  durationSeconds: number;
  bpm: number | null;
  bpmSource: MeasurementSource | null;
  keyTonic: number | null;
  keyMode: "major" | "minor" | null;
  keyStatus: KeyStatus;
}

export interface TrackPatch {
  bpm?: number;
  bpm_alternatives?: number[];
  bpm_source?: MeasurementSource;
  key_tonic?: number | null;
  key_mode?: "major" | "minor" | null;
  key_status?: KeyStatus;
}

export interface ApplyPlan {
  patch: TrackPatch;
  applied: string[];
  kept: string[];
  warnings: string[];
}

/**
 * Decides which analysis values replace stored ones. Estimates may replace missing values
 * and earlier estimates; a value the user reviewed, or a key marked not meaningful, is kept.
 */
export function planTrackUpdate(track: TrackEvidence, result: ValidatedAnalysis): ApplyPlan {
  const patch: TrackPatch = {};
  const applied: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];

  const bpm = result.tempo.bpm;
  if (bpm !== null && bpm >= 40 && bpm <= 250) {
    if (track.bpm === null || track.bpmSource === "estimate") {
      patch.bpm = Math.round(bpm * 1000) / 1000;
      patch.bpm_alternatives = result.tempo.alternatives.map((b) => Math.round(b * 1000) / 1000);
      patch.bpm_source = "estimate";
      applied.push("tempo");
    } else kept.push("tempo (reviewed)");
  }

  const key = result.key;
  if (key.tonic !== null && key.mode !== null) {
    if (track.keyStatus === "unknown" || track.keyStatus === "estimated" || track.keyStatus === "uncertain") {
      patch.key_tonic = key.tonic;
      patch.key_mode = key.mode;
      patch.key_status = key.status;
      applied.push(key.status === "uncertain" ? "key (marked uncertain)" : "key");
    } else kept.push(track.keyStatus === "reviewed" ? "key (reviewed)" : "key (marked not meaningful)");
  }

  if (Math.abs(track.durationSeconds - result.durationSeconds) > 1) {
    warnings.push(
      `The decoded audio is ${result.durationSeconds.toFixed(1)} s but the track says ${track.durationSeconds.toFixed(1)} s; the stored duration was kept. Check that this is the same file.`,
    );
  }
  return { patch, applied, kept, warnings };
}

export interface ExistingRegion {
  kind: "entry" | "exit";
  startSeconds: number;
  endSeconds: number;
}

/** Suggestions closer than this to an existing region of the same kind are not added again. */
export const DUPLICATE_TOLERANCE_SECONDS = 0.5;

/**
 * Cue suggestions that fit inside the stored duration and do not repeat a region the user
 * already has, whether approved or rejected, so a re-analysis never re-suggests a decision.
 */
export function fittingCues(result: ValidatedAnalysis, durationSeconds: number, existing: ExistingRegion[] = []) {
  return result.cues.filter(
    (c) =>
      c.endSeconds > c.startSeconds &&
      c.endSeconds <= durationSeconds + 1e-6 &&
      !existing.some(
        (e) =>
          e.kind === c.kind &&
          Math.abs(e.startSeconds - c.startSeconds) < DUPLICATE_TOLERANCE_SECONDS &&
          Math.abs(e.endSeconds - c.endSeconds) < DUPLICATE_TOLERANCE_SECONDS,
      ),
  );
}
