import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandTempo, gridForDisplay } from "@/lib/rekordbox/grid";
import { candidateFor, styleTagsFrom } from "@/lib/rekordbox/map";
import { parseLibrary, pathFromLocation, RekordboxError, type TempoMarker } from "@/lib/rekordbox/read";
import { rekordboxTrackSchema } from "@/lib/rekordbox/schema";

const repo = join(__dirname, "..", "..", "..");
const xml = readFileSync(join(repo, "tests", "data", "rekordbox-collection.xml"));
const fixture = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "rekordbox", "collection.json"), "utf8")) as {
  productName: string;
  productVersion: string;
  tracks: Array<{ trackId: number; location: string; path: string | null; attributes: Record<string, string>; tempo: TempoMarker[]; marks: unknown[]; grid: { beats: number[]; positions: number[] } | null }>;
  grids: Record<string, { markers: TempoMarker[]; duration: number; beats: number[]; positions: number[] }>;
};

const wrap = (tracks: string) => `<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION>${tracks}</COLLECTION></DJ_PLAYLISTS>`;

describe("Rekordbox reader parity with the CLI", () => {
  const library = parseLibrary(new Uint8Array(xml));

  it("reads the product and every track like read.py", () => {
    expect(library.productName).toBe(fixture.productName);
    expect(library.productVersion).toBe(fixture.productVersion);
    expect(library.tracks.map((t) => t.trackId)).toEqual(fixture.tracks.map((t) => t.trackId));
    library.tracks.forEach((track, i) => {
      const expected = fixture.tracks[i]!;
      expect(track.location).toBe(expected.location);
      expect(pathFromLocation(track.location)).toBe(expected.path);
      expect(track.attributes).toEqual(expected.attributes);
      expect(track.tempo).toEqual(expected.tempo);
      expect(track.marks).toEqual(expected.marks);
    });
  });

  it("expands collection grids like grid.py", () => {
    library.tracks.forEach((track, i) => {
      const expected = fixture.tracks[i]!.grid;
      if (!expected) return;
      const got = expandTempo(track.tempo, Number(track.attributes.TotalTime));
      expect(got.positions).toEqual(expected.positions);
      got.beats.forEach((b, j) => expect(b).toBeCloseTo(expected.beats[j]!, 9));
    });
  });

  it.each(Object.keys(fixture.grids))("expands the %s tempo map like grid.py", (name) => {
    const g = fixture.grids[name]!;
    const got = expandTempo(g.markers, g.duration);
    expect(got.positions).toEqual(g.positions);
    expect(got.beats.length).toBe(g.beats.length);
    got.beats.forEach((b, j) => expect(b).toBeCloseTo(g.beats[j]!, 9));
  });

  it("marks bar lines for display", () => {
    const g = fixture.grids.two_tempos!;
    const { downbeats } = gridForDisplay(g.markers, g.duration);
    // Battito 3 at the first marker: the first bar line is two beats in.
    expect(downbeats[0]).toBeCloseTo(0.051 + 2 * (60 / 123), 9);
    expect(downbeats).toContain(120.051);
  });
});

describe("Rekordbox reader safety and validation", () => {
  it("refuses DOCTYPE and entity declarations", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><DJ_PLAYLISTS><COLLECTION/></DJ_PLAYLISTS>`;
    expect(() => parseLibrary(evil)).toThrow(/must not contain a DOCTYPE/);
  });

  it("rejects malformed XML and other roots", () => {
    expect(() => parseLibrary("<DJ_PLAYLISTS><COLLECTION></DJ_PLAYLISTS>")).toThrow(RekordboxError);
    expect(() => parseLibrary("<OTHER/>")).toThrow(/root is OTHER/);
    expect(() => parseLibrary("<DJ_PLAYLISTS/>")).toThrow(/has no COLLECTION/);
    expect(() => parseLibrary('<DJ_PLAYLISTS a="1" a="2"><COLLECTION/></DJ_PLAYLISTS>')).toThrow(/duplicate attribute/);
    expect(() => parseLibrary('<DJ_PLAYLISTS a="&nope;"><COLLECTION/></DJ_PLAYLISTS>')).toThrow(/undefined entity/);
  });

  it("decodes attribute entities and character references", () => {
    const lib = parseLibrary(wrap(`<TRACK TrackID="1" Name="A &amp; B &#233;&#x41;" Location="file://localhost/x.mp3"/>`));
    expect(lib.tracks[0]!.attributes.Name).toBe("A & B éA");
  });

  it("validates tempo markers and marks like model.py", () => {
    const track = (child: string) => wrap(`<TRACK TrackID="7" Location="file://localhost/x.mp3">${child}</TRACK>`);
    expect(() => parseLibrary(track(`<TEMPO Inizio="0" Bpm="120" Metro="4/4" Battito="5"/>`))).toThrow(/track 7: Battito/);
    expect(() => parseLibrary(track(`<TEMPO Inizio="0" Bpm="0" Metro="4/4" Battito="1"/>`))).toThrow(/Bpm must be positive/);
    expect(() => parseLibrary(track(`<TEMPO Inizio="0" Bpm="120" Metro="four" Battito="1"/>`))).toThrow(/Metro/);
    expect(() => parseLibrary(track(`<TEMPO Inizio="0" Bpm="120" Metro="4/4" Battito="1" X="1"/>`))).toThrow(/unsupported attributes: X/);
    expect(() => parseLibrary(track(`<POSITION_MARK Type="4" Start="1" Num="-1"/>`))).toThrow(/a loop needs End/);
    expect(() => parseLibrary(track(`<POSITION_MARK Type="0" Start="1" Num="8"/>`))).toThrow(/hot cue slot/);
    expect(() => parseLibrary(track(`<POSITION_MARK Type="0" Start="1" Red="1"/>`))).toThrow(/Red, Green, Blue/);
    expect(() => parseLibrary(wrap(`<TRACK Location="file://localhost/x.mp3"/>`))).toThrow(/track #1: missing attribute TrackID/);
    expect(() => parseLibrary(wrap(`<TRACK TrackID="1" Location="a"/><TRACK TrackID="1" Location="b"/>`))).toThrow(/duplicate TrackID 1/);
  });

  it("decodes local paths and leaves streaming locations out", () => {
    expect(pathFromLocation("file://localhost/Users/me/Music/a%20b.mp3")).toBe("/Users/me/Music/a b.mp3");
    expect(pathFromLocation("file://localhost/soundcloud:tracks:1")).toBeNull();
    expect(pathFromLocation("https://example.com/a.mp3")).toBeNull();
  });
});

describe("Rekordbox to library rows", () => {
  const [club, two, stream, sampler] = parseLibrary(new Uint8Array(xml)).tracks.map(candidateFor);

  it("maps metadata as estimates and keeps the grid", () => {
    expect(club).toMatchObject({ title: "Club Track", artist: "Artist A", styleTags: ["Tech House"], durationSeconds: 360, bpm: 124, blocked: null, caution: null });
    expect(club!.key).toEqual({ tonic: 9, mode: "minor" });
    expect(club!.beatCount).toBe(fixture.tracks[0]!.grid!.beats.length);
    expect(club!.fileName).toBe("Café 100%.mp3");
    expect(rekordboxTrackSchema.safeParse({ ...club, durationSeconds: club!.durationSeconds }).success).toBe(true);
  });

  it("blocks tracks without a file or duration and flags samples", () => {
    expect(two!.blocked).toBe("No duration in the export");
    expect(stream!.blocked).toBe("Streaming or non-file location");
    expect(sampler!.blocked).toBe("No duration in the export");
    const short = candidateFor({ trackId: 9, location: "file://localhost/C:/rekordbox/Sampler/x.wav", attributes: { Name: "Hit", TotalTime: "2" }, tempo: [], marks: [] });
    expect(short.caution).toMatch(/sample/);
  });

  it("splits genres into style tags", () => {
    expect(styleTagsFrom("House / Tech House, house;Afro")).toEqual(["House", "Tech House", "Afro"]);
  });
});
