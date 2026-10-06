import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createUser, migratedDb } from "./pglite";

let db: PGlite;
let alice: string;

const LOCATION = "file://localhost/C:/Music/Moth.mp3";

const track = {
  title: "Moth",
  artist: "Audion",
  version_label: "Original",
  duration_seconds: 413,
  style_tags: ["Techno", "Minimal"],
  bpm: 126,
  key_tonic: 9,
  key_mode: "minor",
};
const link = (location: string) => ({
  rekordbox_track_id: 7,
  location,
  product: { name: "rekordbox", version: "7.2.19" },
  tempo: [{ startSeconds: 0.1, bpm: 126, meter: "4/4", beatInBar: 1 }],
  marks: [],
});

function createTrack(tx: Transaction, t: object, l: object) {
  return tx.query<{ ids: { track_id: string; link_id: string } }>("select public.create_rekordbox_track($1, $2) as ids", [t, l]);
}

beforeAll(async () => {
  db = await migratedDb();
  alice = await createUser(db);
}, 60_000);

describe("create_rekordbox_track", () => {
  it("creates the track with estimated tempo and key, and its link, together", async () => {
    const { rows } = await asUser(db, alice, (tx) => createTrack(tx, track, link(LOCATION)));
    const { track_id, link_id } = rows[0]!.ids;
    const saved = await db.query("select owner_id, title, artist, style_tags, bpm::float8 as bpm, bpm_source, key_tonic, key_mode, key_status from public.tracks where id = $1", [track_id]);
    expect(saved.rows).toEqual([
      { owner_id: alice, title: "Moth", artist: "Audion", style_tags: ["Techno", "Minimal"], bpm: 126, bpm_source: "estimate", key_tonic: 9, key_mode: "minor", key_status: "estimated" },
    ]);
    const linked = await db.query("select track_id, location from public.rekordbox_links where id = $1", [link_id]);
    expect(linked.rows).toEqual([{ track_id, location: LOCATION }]);
  });

  it("leaves tempo and key unset when Rekordbox has none", async () => {
    const { rows } = await asUser(db, alice, (tx) => createTrack(tx, { ...track, bpm: null, key_tonic: null, key_mode: null }, link("file://localhost/C:/Music/Other.mp3")));
    const saved = await db.query("select bpm, bpm_source, key_status from public.tracks where id = $1", [rows[0]!.ids.track_id]);
    expect(saved.rows).toEqual([{ bpm: null, bpm_source: null, key_status: "unknown" }]);
  });

  it("creates no track when the link cannot be saved", async () => {
    const count = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.tracks where title = 'Moth'")).rows[0]!.n;
    const before = await count();
    // The location is already linked to the first track.
    await expect(asUser(db, alice, (tx) => createTrack(tx, track, link(LOCATION)))).rejects.toThrow();
    expect(await count()).toBe(before);
  });
});
