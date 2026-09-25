import { parseKey } from "@/lib/domain/camelot";
import { parseTime } from "@/lib/domain/format";
import type { KeyStatus, MeasurementSource, ReviewStatus, VocalActivity } from "@/lib/domain/types";

export const MAX_IMPORT_ROWS = 2500;

export interface ImportedCue {
  kind: "entry" | "exit";
  start_seconds: number;
  end_seconds: number;
  label: string;
  provenance: MeasurementSource;
  review_status: ReviewStatus;
  vocal_activity: VocalActivity;
}

export interface ImportedTrack {
  title: string;
  artist: string;
  version_label: string;
  remix_group: string;
  duration_seconds: number;
  style_tags: string[];
  bpm: number | null;
  bpm_alternatives: number[];
  bpm_source: MeasurementSource | null;
  key_tonic: number | null;
  key_mode: "major" | "minor" | null;
  key_status: KeyStatus;
  energy: number | null;
  energy_source: MeasurementSource | null;
  asset_id: string | null;
  feature_id: string | null;
  notes: string;
  cues: ImportedCue[];
}

export interface ImportProblem {
  row: number;
  message: string;
}

export interface ImportResult {
  format: "json" | "csv";
  tracks: ImportedTrack[];
  problems: ImportProblem[];
}

type Raw = Record<string, unknown>;

/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function pick(raw: Raw, ...names: string[]): unknown {
  for (const name of names) {
    if (raw[name] !== undefined && raw[name] !== null && raw[name] !== "") return raw[name];
  }
  return undefined;
}

function text(value: unknown, max: number): string {
  if (value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function list(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(/[|;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["true", "yes", "1", "reviewed", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function seconds(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseTime(String(value));
}

function numberIn(value: unknown, min: number, max: number): number | null | "invalid" {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < min || n > max) return "invalid";
  return n;
}

function source(value: unknown, reviewedFlag: unknown): MeasurementSource {
  if (value === "reviewed" || value === "estimate") return value;
  return bool(reviewedFlag) ? "reviewed" : "estimate";
}

const KEY_STATUSES: KeyStatus[] = ["unknown", "estimated", "reviewed", "uncertain", "not_meaningful"];
const VOCALS: VocalActivity[] = ["unknown", "none", "present"];
const REVIEWS: ReviewStatus[] = ["pending", "approved", "rejected"];

function parseCue(raw: Raw, kind: "entry" | "exit" | undefined, duration: number, rowNo: number, problems: ImportProblem[]): ImportedCue | null {
  const k = kind ?? (raw.kind === "entry" || raw.kind === "exit" ? raw.kind : undefined);
  if (!k) {
    problems.push({ row: rowNo, message: "A cue needs kind entry or exit; it was skipped." });
    return null;
  }
  const start = seconds(pick(raw, "start", "start_seconds"));
  const end = seconds(pick(raw, "end", "end_seconds"));
  if (start === null || end === null || end <= start || start < 0) {
    problems.push({ row: rowNo, message: `A ${k} cue has an invalid interval; it was skipped.` });
    return null;
  }
  if (end > duration) {
    problems.push({ row: rowNo, message: `A ${k} cue ends after the track; it was skipped.` });
    return null;
  }
  const reviewed = pick(raw, "reviewed");
  const provenance = source(pick(raw, "provenance"), reviewed);
  const reviewRaw = pick(raw, "review_status");
  const review_status = REVIEWS.includes(reviewRaw as ReviewStatus)
    ? (reviewRaw as ReviewStatus)
    : provenance === "reviewed"
      ? "approved"
      : "pending";
  const vocalRaw = String(pick(raw, "vocal", "vocal_activity") ?? "unknown").toLowerCase();
  return {
    kind: k,
    start_seconds: start,
    end_seconds: end,
    label: text(pick(raw, "label"), 120),
    provenance,
    review_status,
    vocal_activity: VOCALS.includes(vocalRaw as VocalActivity) ? (vocalRaw as VocalActivity) : "unknown",
  };
}

/** "1:30-2:00" or "90-120" to a start/end interval for CSV cue columns. */
function cueFromRange(value: unknown): Raw | null {
  if (value === undefined) return null;
  const parts = String(value).split(/\s*-\s*/);
  if (parts.length !== 2) return { start: "x", end: "x" };
  return { start: parts[0], end: parts[1] };
}

function normalize(raw: Raw, rowNo: number, problems: ImportProblem[]): ImportedTrack | null {
  const title = text(pick(raw, "title", "name"), 300);
  if (!title) {
    problems.push({ row: rowNo, message: "Missing title; row skipped." });
    return null;
  }
  const duration = seconds(pick(raw, "duration", "duration_seconds", "length"));
  if (duration === null || duration <= 0 || duration >= 86400) {
    problems.push({ row: rowNo, message: `"${title}": missing or invalid duration; row skipped.` });
    return null;
  }

  const bpm = numberIn(pick(raw, "bpm", "tempo"), 40, 250);
  if (bpm === "invalid") problems.push({ row: rowNo, message: `"${title}": BPM outside 40 to 250 was ignored.` });
  const alternatives = list(pick(raw, "bpm_alternatives", "bpmAlternatives"))
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 40 && n <= 250)
    .slice(0, 4);

  const energy = numberIn(pick(raw, "energy"), 1, 10);
  if (energy === "invalid") problems.push({ row: rowNo, message: `"${title}": energy outside 1 to 10 was ignored.` });

  const keyText = pick(raw, "key", "camelot", "initial_key");
  const statusRaw = pick(raw, "key_status");
  let keyTonic: number | null = null;
  let keyMode: "major" | "minor" | null = null;
  let keyStatus: KeyStatus = "unknown";
  if (keyText !== undefined) {
    const parsed = parseKey(String(keyText));
    if (parsed) {
      keyTonic = parsed.tonic;
      keyMode = parsed.mode;
      keyStatus = bool(pick(raw, "key_reviewed")) ? "reviewed" : "estimated";
    } else problems.push({ row: rowNo, message: `"${title}": key "${String(keyText)}" was not recognized and left unknown.` });
  }
  if (KEY_STATUSES.includes(statusRaw as KeyStatus)) {
    const s = statusRaw as KeyStatus;
    if (keyTonic !== null || s === "unknown" || s === "uncertain" || s === "not_meaningful") keyStatus = s;
  }

  const cues: ImportedCue[] = [];
  const rawCues = pick(raw, "cues");
  if (Array.isArray(rawCues)) {
    for (const c of rawCues) {
      if (c && typeof c === "object") {
        const cue = parseCue(c as Raw, undefined, duration, rowNo, problems);
        if (cue) cues.push(cue);
      }
    }
  }
  const cueReviewed = pick(raw, "cues_reviewed");
  for (const kind of ["entry", "exit"] as const) {
    const range = cueFromRange(pick(raw, `${kind}_cue`));
    if (range) {
      const cue = parseCue({ ...range, reviewed: cueReviewed }, kind, duration, rowNo, problems);
      if (cue) cues.push(cue);
    }
  }

  return {
    title,
    artist: text(pick(raw, "artist", "artists"), 300),
    version_label: text(pick(raw, "version", "version_label", "mix"), 200),
    remix_group: text(pick(raw, "remix_group", "remixGroup"), 200),
    duration_seconds: duration,
    style_tags: [...new Set(list(pick(raw, "styles", "style_tags", "genre", "genres")))].slice(0, 12).map((s) => s.slice(0, 40)),
    bpm: bpm === "invalid" ? null : bpm,
    bpm_alternatives: alternatives,
    bpm_source: bpm === null || bpm === "invalid" ? null : source(pick(raw, "bpm_source"), pick(raw, "bpm_reviewed")),
    key_tonic: keyTonic,
    key_mode: keyMode,
    key_status: keyStatus,
    energy: energy === "invalid" ? null : energy,
    energy_source: energy === null || energy === "invalid" ? null : source(pick(raw, "energy_source"), pick(raw, "energy_reviewed")),
    asset_id: text(pick(raw, "asset_id", "assetId"), 128) || null,
    feature_id: text(pick(raw, "feature_id", "featureId"), 128) || null,
    notes: text(pick(raw, "notes", "comment"), 4000),
    cues,
  };
}

/**
 * Parses a JSON array (or {"tracks": [...]}) or a CSV with a header row.
 * Imported measurements are marked as estimates unless the file says they
 * were reviewed, so review state is never invented.
 */
export function parseLibrary(input: string): ImportResult {
  const trimmedInput = input.trim();
  const problems: ImportProblem[] = [];
  let rows: Raw[];
  let format: "json" | "csv";

  if (trimmedInput.startsWith("[") || trimmedInput.startsWith("{")) {
    format = "json";
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedInput);
    } catch (e) {
      return { format, tracks: [], problems: [{ row: 0, message: `Invalid JSON: ${(e as Error).message}` }] };
    }
    const arr = Array.isArray(parsed) ? parsed : (parsed as { tracks?: unknown }).tracks;
    if (!Array.isArray(arr)) return { format, tracks: [], problems: [{ row: 0, message: 'Expected an array of tracks or {"tracks": [...]}.' }] };
    rows = arr.filter((r): r is Raw => !!r && typeof r === "object");
  } else {
    format = "csv";
    const table = parseCsv(trimmedInput);
    if (table.length < 2) return { format, tracks: [], problems: [{ row: 0, message: "The CSV needs a header row and at least one track." }] };
    const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    rows = table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]?.trim() ?? ""])));
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    problems.push({ row: 0, message: `Only the first ${MAX_IMPORT_ROWS} rows are imported.` });
    rows = rows.slice(0, MAX_IMPORT_ROWS);
  }

  const tracks: ImportedTrack[] = [];
  rows.forEach((raw, i) => {
    const t = normalize(raw, i + 1, problems);
    if (t) tracks.push(t);
  });
  return { format, tracks, problems };
}
