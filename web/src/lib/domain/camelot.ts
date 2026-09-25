import type { KeyMode, KeyStatus } from "./types";

export const PITCH_CLASS_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface MusicalKey {
  tonic: number;
  mode: KeyMode;
}

export interface CamelotCode {
  number: number;
  letter: "A" | "B";
}

/** Camelot number for a key: minor keys use letter A, major keys letter B. */
export function toCamelot(key: MusicalKey): CamelotCode {
  const offset = key.mode === "minor" ? 5 : 8;
  const n = (7 * key.tonic + offset) % 12;
  return { number: n === 0 ? 12 : n, letter: key.mode === "minor" ? "A" : "B" };
}

export function fromCamelot(code: CamelotCode): MusicalKey {
  const offset = code.letter === "A" ? 5 : 8;
  // 7 is its own inverse modulo 12, so tonic = 7 * (number - offset).
  const tonic = (((7 * (code.number - offset)) % 12) + 12) % 12;
  return { tonic, mode: code.letter === "A" ? "minor" : "major" };
}

export function formatCamelot(code: CamelotCode): string {
  return `${code.number}${code.letter}`;
}

export function formatKeyName(key: MusicalKey): string {
  const name = PITCH_CLASS_NAMES[key.tonic] ?? "?";
  return key.mode === "minor" ? `${name} minor` : `${name} major`;
}

/** Keys usable for Camelot comparison. Uncertain or not-meaningful labels abstain. */
export function usableKey(tonic: number | null, mode: KeyMode | null, status: KeyStatus): MusicalKey | null {
  if (tonic === null || mode === null) return null;
  if (status === "unknown" || status === "uncertain" || status === "not_meaningful") return null;
  return { tonic, mode };
}

/**
 * Parses Camelot codes ("8A") and note names
 * ("Am", "A minor", "C#m", "Bb major", "F#", "E♭ min"). Returns null when unparseable.
 */
export function parseKey(input: string): MusicalKey | null {
  const text = input.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (text === "") return null;

  const camelot = /^0?(\d{1,2})\s*([ABab])$/.exec(text);
  if (camelot) {
    const number = Number(camelot[1]);
    if (number < 1 || number > 12) return null;
    return fromCamelot({ number, letter: camelot[2]!.toUpperCase() as "A" | "B" });
  }

  const note = /^([A-Ga-g])\s*(#|b)?\s*(.*)$/.exec(text);
  if (!note) return null;
  const base = NOTE_OFFSETS[note[1]!.toUpperCase()];
  if (base === undefined) return null;
  const accidental = note[2] === "#" ? 1 : note[2] === "b" ? -1 : 0;
  const raw = (note[3] ?? "").trim();
  const rest = raw.toLowerCase();

  let mode: KeyMode;
  if (raw === "M" || rest === "" || rest === "maj" || rest === "major") mode = "major";
  else if (rest === "m" || rest === "min" || rest === "minor") mode = "minor";
  else return null;

  return { tonic: (base + accidental + 12) % 12, mode };
}

export type KeyRelation =
  | "same"
  | "adjacent"
  | "relative"
  | "diagonal"
  | "two_steps"
  | "distant";

export interface KeyComparison {
  relation: KeyRelation;
  steps: number;
  cost: number;
  description: string;
}

function wheelSteps(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

/**
 * Compares two keys on the Camelot wheel. The cost is a candidate-ranking
 * heuristic, not a measurement of how well two passages blend.
 */
export function compareKeys(a: MusicalKey, b: MusicalKey): KeyComparison {
  const ca = toCamelot(a);
  const cb = toCamelot(b);
  const steps = wheelSteps(ca.number, cb.number);
  const sameLetter = ca.letter === cb.letter;
  const label = `${formatCamelot(ca)} to ${formatCamelot(cb)}`;

  if (steps === 0 && sameLetter) return { relation: "same", steps, cost: 0, description: `same Camelot key ${formatCamelot(ca)}` };
  if (steps === 1 && sameLetter) return { relation: "adjacent", steps, cost: 0.15, description: `${label}, adjacent on the wheel` };
  if (steps === 0) return { relation: "relative", steps, cost: 0.2, description: `${label}, relative major/minor` };
  if (steps === 1) return { relation: "diagonal", steps, cost: 0.45, description: `${label}, diagonal move` };
  if (steps === 2 && sameLetter) return { relation: "two_steps", steps, cost: 0.5, description: `${label}, two steps on the wheel` };
  const cost = Math.min(1, 0.6 + 0.1 * (steps - 2) + (sameLetter ? 0 : 0.05));
  return { relation: "distant", steps, cost, description: `${label}, ${steps} steps apart` };
}

/** Shifts a key by a whole number of semitones (for playback without key lock). */
export function transposeKey(key: MusicalKey, semitones: number): MusicalKey {
  return { tonic: (((key.tonic + semitones) % 12) + 12) % 12, mode: key.mode };
}

export function describeTrackKey(tonic: number | null, mode: KeyMode | null, status: KeyStatus): string {
  if (status === "not_meaningful") return "Not meaningful";
  if (tonic === null || mode === null) return "Unavailable";
  const key = { tonic, mode };
  return `${formatCamelot(toCamelot(key))} · ${formatKeyName(key)}`;
}
