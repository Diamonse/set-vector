/**
 * Map Rekordbox collection tracks to SetVector library rows. Rekordbox values become
 * estimates: its tempo and key come from its own analysis, and its grid is the preferred
 * bar grid for review, not ground truth.
 */
import { parseKey, type MusicalKey } from "@/lib/domain/camelot";
import { mapRekordboxCues } from "./cues";
import { expandTempo } from "./grid";
import { fileNameOf, pathFromLocation, type PositionMark, type RekordboxTrack, type TempoMarker } from "./read";

export const SHORT_SAMPLE_SECONDS = 30;
export const MAX_MARKERS = 2000;
export const MAX_MARKS = 200;

export interface RekordboxCandidate {
  rekordboxTrackId: number;
  location: string;
  fileName: string | null;
  title: string;
  artist: string;
  versionLabel: string;
  styleTags: string[];
  durationSeconds: number | null;
  bpm: number | null;
  key: MusicalKey | null;
  tonality: string;
  tempo: TempoMarker[];
  marks: PositionMark[];
  beatCount: number;
  /** Cue regions the import will create: from cues (approved) and from the grid (pending). */
  cueRegions: { entries: number; exits: number; fromGrid: number; ignored: number };
  /** Why the track cannot be imported, or null. */
  blocked: string | null;
  /** A reason to leave it unselected by default, or null. */
  caution: string | null;
  notes: string[];
}

function clip(text: string, max: number): string {
  return text.trim().slice(0, max);
}

function stem(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

/** Split a Rekordbox genre field into up to 12 style tags of at most 40 characters. */
export function styleTagsFrom(genre: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of genre.split(/[,;/|]/)) {
    const tag = part.trim();
    if (!tag || tag.length > 40 || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags.slice(0, 12);
}

export function candidateFor(track: RekordboxTrack): RekordboxCandidate {
  const a = track.attributes;
  const path = pathFromLocation(track.location);
  const fileName = path ? fileNameOf(path) : null;
  const notes: string[] = [];
  let blocked: string | null = null;
  let caution: string | null = null;

  const title = clip(a.Name ?? "", 300) || (fileName ? clip(stem(fileName), 300) : "");
  const total = Number(a.TotalTime);
  const durationSeconds = Number.isFinite(total) && total > 0 && total < 86400 ? total : null;
  const average = Number(a.AverageBpm);
  const bpm = Number.isFinite(average) && average >= 40 && average <= 250 ? Math.round(average * 1000) / 1000 : null;
  const tonality = (a.Tonality ?? "").trim();
  const key = tonality ? parseKey(tonality) : null;
  if (tonality && !key) notes.push(`Key "${tonality}" was not recognized`);

  if (!path) blocked = "Streaming or non-file location";
  else if (!title) blocked = "No title or file name";
  else if (durationSeconds === null) blocked = "No duration in the export";
  else if (durationSeconds < SHORT_SAMPLE_SECONDS || /\/rekordbox\/Sampler\//i.test(path)) caution = "Short sample or sampler file";

  let tempo = track.tempo;
  let beatCount = 0;
  if (tempo.length > MAX_MARKERS) {
    notes.push(`Grid has ${tempo.length} tempo markers; only grids up to ${MAX_MARKERS} are kept`);
    tempo = [];
  }
  if (tempo.length && durationSeconds !== null) {
    try {
      beatCount = expandTempo(tempo, durationSeconds).beats.length;
    } catch (error) {
      notes.push(`Grid not kept: ${(error as Error).message}`);
      tempo = [];
    }
  }
  if (!tempo.length && !blocked) notes.push("No beat grid");
  const marks = track.marks.slice(0, MAX_MARKS);
  if (track.marks.length > MAX_MARKS) notes.push(`Only the first ${MAX_MARKS} cue points are kept`);

  const cueRegions = { entries: 0, exits: 0, fromGrid: 0, ignored: 0 };
  if (durationSeconds !== null) {
    const mapped = mapRekordboxCues(marks, tempo, durationSeconds, bpm);
    for (const r of mapped.regions) {
      if (r.origin === "rekordbox_grid") cueRegions.fromGrid++;
      else if (r.kind === "entry") cueRegions.entries++;
      else cueRegions.exits++;
    }
    cueRegions.ignored = mapped.ignored;
  }

  return {
    rekordboxTrackId: track.trackId,
    location: track.location,
    fileName,
    title,
    artist: clip(a.Artist ?? "", 300),
    versionLabel: clip(a.Mix ?? "", 200),
    styleTags: styleTagsFrom(a.Genre ?? ""),
    durationSeconds,
    bpm,
    key,
    tonality,
    tempo,
    marks,
    beatCount,
    cueRegions,
    blocked,
    caution,
    notes,
  };
}
