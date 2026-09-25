import type { Annotation, Crate, CueRegion, Track } from "@/lib/domain/types";
import type { PlannerTrack } from "@/lib/planner";

/** Row shapes returned by PostgREST for the SetVector schema. */
export interface CueRow {
  id: string;
  track_id: string;
  kind: CueRegion["kind"];
  start_seconds: number | string;
  end_seconds: number | string;
  label: string;
  provenance: CueRegion["provenance"];
  review_status: CueRegion["reviewStatus"];
  vocal_activity: CueRegion["vocalActivity"];
}

export interface TrackRow {
  id: string;
  title: string;
  artist: string;
  version_label: string;
  remix_group: string;
  duration_seconds: number | string;
  style_tags: string[] | null;
  bpm: number | string | null;
  bpm_alternatives: (number | string)[] | null;
  bpm_source: Track["bpmSource"];
  key_tonic: number | null;
  key_mode: Track["keyMode"];
  key_status: Track["keyStatus"];
  energy: number | string | null;
  energy_source: Track["energySource"];
  asset_id: string | null;
  feature_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  cue_regions?: CueRow[] | null;
}

export interface AnnotationRow {
  id: string;
  level: Annotation["level"];
  task: string;
  track_id: string | null;
  to_track_id: string | null;
  plan_id: string | null;
  region_start_seconds: number | string | null;
  region_end_seconds: number | string | null;
  is_estimate: boolean;
  payload: Record<string, unknown> | null;
  note: string;
  revision: number;
  supersedes_id: string | null;
  created_at: string;
}

export interface CrateRow {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  crate_tracks?: { track_id: string; position: number }[] | null;
}

const num = (v: number | string) => (typeof v === "number" ? v : Number(v));
const numOrNull = (v: number | string | null) => (v === null ? null : num(v));

export function toCue(row: CueRow): CueRegion {
  return {
    id: row.id,
    trackId: row.track_id,
    kind: row.kind,
    startSeconds: num(row.start_seconds),
    endSeconds: num(row.end_seconds),
    label: row.label,
    provenance: row.provenance,
    reviewStatus: row.review_status,
    vocalActivity: row.vocal_activity,
  };
}

export function toTrack(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    versionLabel: row.version_label,
    remixGroup: row.remix_group,
    durationSeconds: num(row.duration_seconds),
    styleTags: row.style_tags ?? [],
    bpm: numOrNull(row.bpm),
    bpmAlternatives: (row.bpm_alternatives ?? []).map(num),
    bpmSource: row.bpm_source,
    keyTonic: row.key_tonic,
    keyMode: row.key_mode,
    keyStatus: row.key_status,
    energy: numOrNull(row.energy),
    energySource: row.energy_source,
    assetId: row.asset_id,
    featureId: row.feature_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cues: (row.cue_regions ?? []).map(toCue).sort((a, b) => a.startSeconds - b.startSeconds),
  };
}

export function toAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    level: row.level,
    task: row.task,
    trackId: row.track_id,
    toTrackId: row.to_track_id,
    planId: row.plan_id,
    regionStartSeconds: numOrNull(row.region_start_seconds),
    regionEndSeconds: numOrNull(row.region_end_seconds),
    isEstimate: row.is_estimate,
    payload: row.payload ?? {},
    note: row.note,
    revision: row.revision,
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
  };
}

export function toCrate(row: CrateRow): Crate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trackIds: (row.crate_tracks ?? []).slice().sort((a, b) => a.position - b.position).map((c) => c.track_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPlannerTrack(track: Track): PlannerTrack {
  return {
    id: track.id,
    title: track.versionLabel ? `${track.title} (${track.versionLabel})` : track.title,
    artist: track.artist,
    remixGroup: track.remixGroup,
    durationSeconds: track.durationSeconds,
    styleTags: track.styleTags,
    bpm: track.bpm,
    bpmAlternatives: track.bpmAlternatives,
    keyTonic: track.keyTonic,
    keyMode: track.keyMode,
    keyStatus: track.keyStatus,
    energy: track.energy,
    cues: track.cues.map((c) => ({
      id: c.id,
      kind: c.kind,
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      label: c.label,
      provenance: c.provenance,
      reviewStatus: c.reviewStatus,
      vocalActivity: c.vocalActivity,
    })),
  };
}
