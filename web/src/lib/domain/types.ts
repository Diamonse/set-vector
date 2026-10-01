export type MeasurementSource = "estimate" | "reviewed";
export type KeyStatus = "unknown" | "estimated" | "reviewed" | "uncertain" | "not_meaningful";
export type KeyMode = "major" | "minor";
export type CueKind = "entry" | "exit";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type VocalActivity = "unknown" | "none" | "present";
export type AnnotationLevel = "track" | "region" | "pair" | "sequence";
export type PlanMode = "dj" | "listening";
export type SelectionPolicy = "use_all" | "choose_from_pool";

export const STYLE_SUGGESTIONS = ["House", "Hip-hop", "Pop", "EDM", "BollyHouse", "Bollywood"] as const;

export interface CueRegion {
  id: string;
  trackId: string;
  kind: CueKind;
  startSeconds: number;
  endSeconds: number;
  label: string;
  provenance: MeasurementSource;
  reviewStatus: ReviewStatus;
  vocalActivity: VocalActivity;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  versionLabel: string;
  remixGroup: string;
  durationSeconds: number;
  styleTags: string[];
  bpm: number | null;
  bpmAlternatives: number[];
  bpmSource: MeasurementSource | null;
  keyTonic: number | null;
  keyMode: KeyMode | null;
  keyStatus: KeyStatus;
  energy: number | null;
  energySource: MeasurementSource | null;
  assetId: string | null;
  featureId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  cues: CueRegion[];
}

export interface Annotation {
  id: string;
  level: AnnotationLevel;
  task: string;
  trackId: string | null;
  toTrackId: string | null;
  planId: string | null;
  regionStartSeconds: number | null;
  regionEndSeconds: number | null;
  isEstimate: boolean;
  payload: Record<string, unknown>;
  note: string;
  revision: number;
  supersedesId: string | null;
  createdAt: string;
}

export interface Crate {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}
