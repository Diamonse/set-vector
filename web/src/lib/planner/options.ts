import type { PlanMode } from "@/lib/domain/types";
import { BLEND_BEATS, FALLBACK_REGION_SECONDS } from "./defaults";
import type { CueOption, OptionOrigin, PlannerCue, PlannerTrack } from "./types";

function originOf(cue: PlannerCue): OptionOrigin {
  if (cue.reviewStatus === "pending") return "pending";
  return cue.provenance === "reviewed" ? "reviewed" : "estimated";
}

function fallbackLength(track: PlannerTrack): number {
  const phrase = track.bpm ? (BLEND_BEATS * 60) / track.bpm : FALLBACK_REGION_SECONDS;
  return Math.min(Math.max(phrase, 8), FALLBACK_REGION_SECONDS * 2, track.durationSeconds / 3);
}

/**
 * Entry or exit options for one track. DJ mode uses non-rejected cue regions,
 * falling back to an explicitly labeled intro or outro window. Listening mode
 * plays whole tracks.
 */
export function cueOptions(track: PlannerTrack, kind: "entry" | "exit", mode: PlanMode): CueOption[] {
  if (mode === "listening") {
    const window = Math.min(20, track.durationSeconds / 4);
    return [
      kind === "entry"
        ? {
            id: `${track.id}:start`,
            trackId: track.id,
            kind,
            startSeconds: 0,
            endSeconds: window,
            label: "Track start",
            origin: "full_track",
            vocalActivity: "unknown",
          }
        : {
            id: `${track.id}:end`,
            trackId: track.id,
            kind,
            startSeconds: Math.max(0, track.durationSeconds - window),
            endSeconds: track.durationSeconds,
            label: "Track end",
            origin: "full_track",
            vocalActivity: "unknown",
          },
    ];
  }

  const cues = track.cues
    .filter((c) => c.kind === kind && c.reviewStatus !== "rejected" && c.endSeconds <= track.durationSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map<CueOption>((c) => ({
      id: c.id,
      trackId: track.id,
      kind,
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      label: c.label || (kind === "entry" ? "Entry cue" : "Exit cue"),
      origin: originOf(c),
      vocalActivity: c.vocalActivity,
    }));
  if (cues.length > 0) return cues;

  const length = fallbackLength(track);
  return [
    kind === "entry"
      ? {
          id: `${track.id}:fallback-entry`,
          trackId: track.id,
          kind,
          startSeconds: 0,
          endSeconds: length,
          label: "Intro window (no reviewed cue)",
          origin: "fallback",
          vocalActivity: "unknown",
        }
      : {
          id: `${track.id}:fallback-exit`,
          trackId: track.id,
          kind,
          startSeconds: Math.max(0, track.durationSeconds - length),
          endSeconds: track.durationSeconds,
          label: "Outro window (no reviewed cue)",
          origin: "fallback",
          vocalActivity: "unknown",
        },
  ];
}

/** Typical played span used for duration estimates before cues are jointly assigned. */
export function typicalPlayedSeconds(track: PlannerTrack, mode: PlanMode): number {
  if (mode === "listening") return track.durationSeconds;
  const entry = cueOptions(track, "entry", mode)[0]!;
  const exits = cueOptions(track, "exit", mode);
  const exit = exits[exits.length - 1]!;
  const span = exit.startSeconds - entry.startSeconds;
  return span > 0 ? span : track.durationSeconds;
}
