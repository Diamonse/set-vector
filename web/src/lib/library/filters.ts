/**
 * Column filters and sorting shared by the library table and the track picker. Pure
 * functions over a minimal track shape so both views (and tests) use the same rules.
 */
import { compareKeys, fromCamelot, toCamelot, usableKey, type MusicalKey } from "@/lib/domain/camelot";
import type { KeyMode, KeyStatus } from "@/lib/domain/types";

export type CueState = "ready" | "pending" | "partial" | "none";

export interface FilterableTrack {
  id: string;
  title: string;
  artist: string;
  versionLabel: string;
  styleTags: string[];
  bpm: number | null;
  keyTonic: number | null;
  keyMode: KeyMode | null;
  keyStatus: KeyStatus;
  energy: number | null;
  durationSeconds: number;
  updatedAt?: string;
  cues?: { kind: "entry" | "exit"; reviewStatus: "pending" | "approved" | "rejected" }[];
  /** Precomputed cue state when the cue list itself is not sent to the browser. */
  cueState?: CueState;
}

export interface TrackFilters {
  text: string;
  style: string;
  bpmMin: string;
  bpmMax: string;
  /** Also match tracks whose half or double tempo is in range. */
  bpmHalfDouble: boolean;
  /** Camelot code such as "8A", or "" for any; "none" for tracks without a usable key. */
  key: string;
  /** Match keys that mix harmonically with `key` (same, adjacent, relative) instead of only the same key. */
  keyCompatible: boolean;
  energyMin: string;
  energyMax: string;
  /** Lengths as m:ss or seconds. */
  lengthMin: string;
  lengthMax: string;
  cues: "" | CueState;
}

export const EMPTY_FILTERS: TrackFilters = {
  text: "",
  style: "",
  bpmMin: "",
  bpmMax: "",
  bpmHalfDouble: false,
  key: "",
  keyCompatible: false,
  energyMin: "",
  energyMax: "",
  lengthMin: "",
  lengthMax: "",
  cues: "",
};

export const CAMELOT_CODES = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat();

export const CUE_STATE_LABEL: Record<CueState, string> = {
  ready: "Approved in and out",
  pending: "Has pending regions",
  partial: "Missing in or out",
  none: "No cue regions",
};

export function cueStateOf(t: FilterableTrack): CueState {
  if (t.cueState) return t.cueState;
  const cues = (t.cues ?? []).filter((c) => c.reviewStatus !== "rejected");
  if (cues.length === 0) return "none";
  const approvedIn = cues.some((c) => c.kind === "entry" && c.reviewStatus === "approved");
  const approvedOut = cues.some((c) => c.kind === "exit" && c.reviewStatus === "approved");
  if (approvedIn && approvedOut) return "ready";
  if (cues.some((c) => c.reviewStatus === "pending")) return "pending";
  return "partial";
}

function num(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Parses m:ss, h:mm:ss, or plain seconds; null when empty or invalid. */
export function parseLength(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function parseCamelot(code: string): MusicalKey | null {
  const m = /^(\d{1,2})([AB])$/.exec(code);
  if (!m) return null;
  const number = Number(m[1]);
  if (number < 1 || number > 12) return null;
  return fromCamelot({ number, letter: m[2] as "A" | "B" });
}

const COMPATIBLE = new Set(["same", "adjacent", "relative"]);

function inRange(value: number, min: number | null, max: number | null): boolean {
  return (min === null || value >= min - 1e-9) && (max === null || value <= max + 1e-9);
}

export function activeFilterCount(f: TrackFilters): number {
  let n = 0;
  if (f.text.trim()) n++;
  if (f.style) n++;
  if (num(f.bpmMin) !== null || num(f.bpmMax) !== null) n++;
  if (f.key) n++;
  if (num(f.energyMin) !== null || num(f.energyMax) !== null) n++;
  if (parseLength(f.lengthMin) !== null || parseLength(f.lengthMax) !== null) n++;
  if (f.cues) n++;
  return n;
}

export function filterTracks<T extends FilterableTrack>(tracks: T[], f: TrackFilters): T[] {
  const q = f.text.trim().toLowerCase();
  const bpmMin = num(f.bpmMin);
  const bpmMax = num(f.bpmMax);
  const energyMin = num(f.energyMin);
  const energyMax = num(f.energyMax);
  const lengthMin = parseLength(f.lengthMin);
  const lengthMax = parseLength(f.lengthMax);
  const target = f.key && f.key !== "none" ? parseCamelot(f.key) : null;

  return tracks.filter((t) => {
    if (q && !`${t.title} ${t.artist} ${t.versionLabel}`.toLowerCase().includes(q)) return false;
    if (f.style && !t.styleTags.includes(f.style)) return false;
    if (bpmMin !== null || bpmMax !== null) {
      if (t.bpm === null) return false;
      const candidates = f.bpmHalfDouble ? [t.bpm, t.bpm / 2, t.bpm * 2] : [t.bpm];
      if (!candidates.some((b) => inRange(b, bpmMin, bpmMax))) return false;
    }
    if (f.key) {
      const key = usableKey(t.keyTonic, t.keyMode, t.keyStatus);
      if (f.key === "none") {
        if (key) return false;
      } else {
        if (!key || !target) return false;
        if (f.keyCompatible ? !COMPATIBLE.has(compareKeys(target, key).relation) : !(key.tonic === target.tonic && key.mode === target.mode)) return false;
      }
    }
    if (energyMin !== null || energyMax !== null) {
      if (t.energy === null || !inRange(t.energy, energyMin, energyMax)) return false;
    }
    if (!inRange(t.durationSeconds, lengthMin, lengthMax)) return false;
    if (f.cues && cueStateOf(t) !== f.cues) return false;
    return true;
  });
}

export type SortKey = "title" | "artist" | "style" | "bpm" | "key" | "energy" | "length" | "cues" | "updated";
export type SortDir = "asc" | "desc";

export const SORT_LABEL: Record<SortKey, string> = {
  title: "Title",
  artist: "Artist",
  style: "Style",
  bpm: "BPM",
  key: "Key",
  energy: "Energy",
  length: "Length",
  cues: "Cues",
  updated: "Recently updated",
};

/** Natural first direction for each column: numbers that matter most high first. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  title: "asc",
  artist: "asc",
  style: "asc",
  bpm: "asc",
  key: "asc",
  energy: "desc",
  length: "asc",
  cues: "desc",
  updated: "desc",
};

const CUE_RANK: Record<CueState, number> = { ready: 3, pending: 2, partial: 1, none: 0 };

function keyRank(t: FilterableTrack): number | null {
  const key = usableKey(t.keyTonic, t.keyMode, t.keyStatus);
  if (!key) return null;
  const c = toCamelot(key);
  return c.number * 2 + (c.letter === "B" ? 1 : 0);
}

/** Sort a copy. Missing values always go last, whichever the direction. */
export function sortTracks<T extends FilterableTrack>(tracks: T[], key: SortKey, dir: SortDir): T[] {
  const value = (t: T): string | number | null => {
    switch (key) {
      case "title":
        return t.title.toLowerCase();
      case "artist":
        return t.artist ? t.artist.toLowerCase() : null;
      case "style":
        return t.styleTags[0]?.toLowerCase() ?? null;
      case "bpm":
        return t.bpm;
      case "key":
        return keyRank(t);
      case "energy":
        return t.energy;
      case "length":
        return t.durationSeconds;
      case "cues":
        return CUE_RANK[cueStateOf(t)];
      case "updated":
        return t.updatedAt ?? null;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...tracks].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return a.title.localeCompare(b.title);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c !== 0 ? sign * c : a.title.localeCompare(b.title);
  });
}
