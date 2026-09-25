import type { PlannerCue, PlannerTrack } from "@/lib/planner";

let cueCounter = 0;

export function cue(kind: "entry" | "exit", start: number, end: number, extra: Partial<PlannerCue> = {}): PlannerCue {
  cueCounter++;
  return {
    id: `cue-${cueCounter}`,
    kind,
    startSeconds: start,
    endSeconds: end,
    label: kind === "entry" ? "Intro" : "Outro",
    provenance: "reviewed",
    reviewStatus: "approved",
    vocalActivity: "none",
    ...extra,
  };
}

export function track(id: string, extra: Partial<PlannerTrack> = {}): PlannerTrack {
  const duration = extra.durationSeconds ?? 300;
  return {
    id,
    title: `Track ${id}`,
    artist: `Artist ${id}`,
    remixGroup: "",
    durationSeconds: duration,
    styleTags: ["House"],
    bpm: 124,
    bpmAlternatives: [],
    keyTonic: 9,
    keyMode: "minor",
    keyStatus: "reviewed",
    energy: 5,
    cues: [cue("entry", 0, 30), cue("exit", duration - 45, duration)],
    ...extra,
  };
}
