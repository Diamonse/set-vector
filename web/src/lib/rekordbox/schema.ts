import { z } from "zod";
import { HOT_CUE_SLOTS, MARK_KINDS } from "./read";
import { MAX_MARKERS, MAX_MARKS } from "./map";

export const REKORDBOX_BATCH = 100;

const tempoMarker = z.object({
  startSeconds: z.number().finite().min(0),
  bpm: z.number().finite().positive().max(1000),
  meter: z.string().regex(/^[1-9][0-9]?\/[1-9][0-9]?$/),
  beatInBar: z.number().int().min(1).max(99),
});

const positionMark = z.object({
  name: z.string().max(200),
  kind: z.enum(MARK_KINDS),
  startSeconds: z.number().finite().min(0),
  endSeconds: z.number().finite().nullable(),
  slot: z.number().int().min(0).max(HOT_CUE_SLOTS - 1).nullable(),
  colour: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]).nullable(),
});

export const rekordboxTrackSchema = z.object({
  rekordboxTrackId: z.number().int().positive(),
  location: z.string().min(1).max(4000),
  title: z.string().trim().min(1).max(300),
  artist: z.string().max(300),
  versionLabel: z.string().max(200),
  styleTags: z.array(z.string().min(1).max(40)).max(12),
  durationSeconds: z.number().positive().lt(86400),
  bpm: z.number().min(40).max(250).nullable(),
  key: z.object({ tonic: z.number().int().min(0).max(11), mode: z.enum(["major", "minor"]) }).nullable(),
  tempo: z.array(tempoMarker).max(MAX_MARKERS),
  marks: z.array(positionMark).max(MAX_MARKS),
});

export const rekordboxImportSchema = z.object({
  product: z.object({ name: z.string().max(100).nullable(), version: z.string().max(100).nullable() }),
  tracks: z.array(rekordboxTrackSchema).min(1).max(REKORDBOX_BATCH),
  /** Library tracks already matched by earlier batches of the same import. */
  claimedTrackIds: z.array(z.uuid()).max(100_000).default([]),
});

export type RekordboxImportTrack = z.infer<typeof rekordboxTrackSchema>;
export type RekordboxImportInput = z.infer<typeof rekordboxImportSchema>;
