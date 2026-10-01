/**
 * Read a Rekordbox collection export. A port of `setvector.rekordbox.read` and the record
 * validation in `setvector.rekordbox.model`; playlists are not read.
 */
import { decodeXml, parseXml, XmlError, type XmlElement } from "./xml";

export const HOT_CUE_SLOTS = 8;
export const SETVECTOR_PREFIX = "SV ";
export const MARK_KINDS = ["cue", "fade_in", "fade_out", "load", "loop"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export interface TempoMarker {
  startSeconds: number;
  bpm: number;
  meter: string;
  beatInBar: number;
}

export interface PositionMark {
  name: string;
  kind: MarkKind;
  startSeconds: number;
  endSeconds: number | null;
  /** Hot cue slot 0 to 7 (A to H), or null for a memory cue. */
  slot: number | null;
  colour: [number, number, number] | null;
}

export interface RekordboxTrack {
  trackId: number;
  location: string;
  /** Every other TRACK attribute, verbatim. */
  attributes: Record<string, string>;
  tempo: TempoMarker[];
  marks: PositionMark[];
}

export interface RekordboxLibrary {
  productName: string | null;
  productVersion: string | null;
  tracks: RekordboxTrack[];
}

export class RekordboxError extends Error {}

const TYPE_TO_KIND: Record<string, MarkKind> = { "0": "cue", "1": "fade_in", "2": "fade_out", "3": "load", "4": "loop" };
const TEMPO_FIELDS = new Set(["Inizio", "Bpm", "Metro", "Battito"]);
const MARK_FIELDS = new Set(["Name", "Type", "Start", "End", "Num", "Red", "Green", "Blue"]);
const COLOUR = ["Red", "Green", "Blue"] as const;
const METER = /^([1-9][0-9]*)\/([1-9][0-9]*)$/;
const INTEGER = /^\s*[+-]?[0-9]+\s*$/;
const NUMBER = /^\s*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?\s*$/;
const LOCAL_PREFIX = "file://localhost/";
const DRIVE = /^[A-Za-z]:\//;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

class MissingAttribute extends Error {}

export function beatsPerBar(marker: TempoMarker): number {
  return Number(marker.meter.split("/")[0]);
}

export function isSetVectorMark(mark: PositionMark): boolean {
  return mark.name.startsWith(SETVECTOR_PREFIX);
}

/** Decode a `file://localhost/` URI; streaming and other locations give null. */
export function pathFromLocation(location: string): string | null {
  if (!location.startsWith(LOCAL_PREFIX)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(location.slice(LOCAL_PREFIX.length));
  } catch {
    rest = location.slice(LOCAL_PREFIX.length);
  }
  if (DRIVE.test(rest)) return rest;
  if (SCHEME.test(rest)) return null;
  return `/${rest}`;
}

/** The file name at the end of a decoded path. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function integer(text: string, field: string): number {
  if (!INTEGER.test(text)) throw new Error(`${field} must be an integer`);
  return Number.parseInt(text.trim(), 10);
}

function number(text: string, field: string): number {
  if (!NUMBER.test(text)) throw new Error(`${field} must be a number`);
  return Number(text.trim());
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

function nonnegative(value: number, field: string): number {
  finite(value, field);
  if (value < 0) throw new Error(`${field} must be nonnegative`);
  return value;
}

function attr(element: XmlElement, name: string): string {
  const value = element.attributes.get(name);
  if (value === undefined) throw new MissingAttribute(name);
  return value;
}

function checkFields(element: XmlElement, allowed: Set<string>): void {
  const unknown = [...element.attributes.keys()].filter((k) => !allowed.has(k)).sort();
  if (unknown.length) throw new Error(`${element.name} has unsupported attributes: ${unknown.join(", ")}`);
}

function tempo(element: XmlElement): TempoMarker {
  checkFields(element, TEMPO_FIELDS);
  const marker = {
    startSeconds: nonnegative(number(attr(element, "Inizio"), "Inizio"), "Inizio"),
    bpm: finite(number(attr(element, "Bpm"), "Bpm"), "Bpm"),
    meter: attr(element, "Metro"),
    beatInBar: integer(attr(element, "Battito"), "Battito"),
  };
  if (marker.bpm <= 0) throw new Error("Bpm must be positive");
  if (!METER.test(marker.meter)) throw new Error("Metro must look like 4/4");
  if (marker.beatInBar < 1 || marker.beatInBar > beatsPerBar(marker)) throw new Error("Battito must be a beat number within the bar");
  return marker;
}

function mark(element: XmlElement): PositionMark {
  checkFields(element, MARK_FIELDS);
  const type = attr(element, "Type");
  const kind = TYPE_TO_KIND[type];
  if (!kind) throw new Error(`unsupported POSITION_MARK Type ${type}`);
  const num = integer(element.attributes.get("Num") ?? "-1", "Num");
  const present = COLOUR.map((c) => element.attributes.has(c));
  if (present.some(Boolean) && !present.every(Boolean)) throw new Error("POSITION_MARK needs all of Red, Green, Blue or none");
  const colour = present.every(Boolean) ? (COLOUR.map((c) => integer(attr(element, c), c)) as [number, number, number]) : null;
  if (colour && colour.some((c) => c < 0 || c > 255)) throw new Error("colour must be three integers from 0 to 255");
  const start = nonnegative(number(attr(element, "Start"), "Start"), "Start");
  const end = element.attributes.has("End") ? finite(number(attr(element, "End"), "End"), "End") : null;
  if (end !== null && end <= start) throw new Error("End must be after Start");
  if (kind === "loop" && end === null) throw new Error("a loop needs End");
  const slot = num === -1 ? null : num;
  if (slot !== null && (slot < 0 || slot >= HOT_CUE_SLOTS)) throw new Error("Num must be -1 or a hot cue slot from 0 to 7");
  return { name: element.attributes.get("Name") ?? "", kind, startSeconds: start, endSeconds: end, slot, colour };
}

function track(element: XmlElement): RekordboxTrack {
  const attributes = Object.fromEntries(element.attributes);
  const trackId = integer(attr(element, "TrackID"), "TrackID");
  const location = attr(element, "Location");
  delete attributes.TrackID;
  delete attributes.Location;
  if (trackId <= 0) throw new Error("TrackID must be a positive integer");
  if (!location) throw new Error("Location must be a nonempty URI");
  const markers: TempoMarker[] = [];
  const marks: PositionMark[] = [];
  for (const child of element.children) {
    if (child.name === "TEMPO") markers.push(tempo(child));
    else if (child.name === "POSITION_MARK") marks.push(mark(child));
  }
  return { trackId, location, attributes, tempo: markers, marks };
}

/** Parse Rekordbox XML text or bytes. Invalid documents raise `RekordboxError`. */
export function parseLibrary(data: string | Uint8Array, source = "Rekordbox XML"): RekordboxLibrary {
  let root: XmlElement;
  try {
    root = parseXml(typeof data === "string" ? data : decodeXml(data));
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    const message = error.message.startsWith("DOCTYPE")
      ? `${source} must not contain a DOCTYPE or entity declarations`
      : `${source} is not valid XML: ${error.message}`;
    throw new RekordboxError(message);
  }
  if (root.name !== "DJ_PLAYLISTS") throw new RekordboxError(`${source} is not a Rekordbox XML export (root is ${root.name})`);
  const collection = root.children.find((c) => c.name === "COLLECTION");
  if (!collection) throw new RekordboxError(`${source} has no COLLECTION`);
  const tracks: RekordboxTrack[] = [];
  const seen = new Set<number>();
  let index = 0;
  for (const element of collection.children) {
    if (element.name !== "TRACK") continue;
    index += 1;
    const label = element.attributes.get("TrackID") || `#${index}`;
    try {
      tracks.push(track(element));
    } catch (error) {
      if (error instanceof MissingAttribute) throw new RekordboxError(`${source}: track ${label}: missing attribute ${error.message}`);
      throw new RekordboxError(`${source}: track ${label}: ${(error as Error).message}`);
    }
    const id = tracks[tracks.length - 1]!.trackId;
    if (seen.has(id)) throw new RekordboxError(`${source}: duplicate TrackID ${id}`);
    seen.add(id);
  }
  const product = root.children.find((c) => c.name === "PRODUCT");
  return {
    productName: product?.attributes.get("Name") ?? null,
    productVersion: product?.attributes.get("Version") ?? null,
    tracks,
  };
}
