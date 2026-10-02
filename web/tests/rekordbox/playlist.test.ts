import { describe, expect, it } from "vitest";
import { buildM3u8, playlistPath, type PlaylistEntry } from "@/lib/rekordbox/playlist";

const entry = (over: Partial<PlaylistEntry>): PlaylistEntry => ({
  title: "Moth",
  artist: "Audion",
  durationSeconds: 412.6,
  location: "file://localhost/C:/Users/dj/Music/Moth.mp3",
  ...over,
});

describe("playlistPath", () => {
  it("uses backslashes for Windows drive paths and decodes the URI", () => {
    expect(playlistPath("file://localhost/C:/Users/dj/Music/Caf%C3%A9%20Del%20Mar.mp3")).toBe("C:\\Users\\dj\\Music\\Café Del Mar.mp3");
  });

  it("keeps macOS paths as they are", () => {
    expect(playlistPath("file://localhost/Users/dj/Music/I%20Wish.aiff")).toBe("/Users/dj/Music/I Wish.aiff");
  });

  it("gives null for missing, streaming, and multi-line locations", () => {
    expect(playlistPath(null)).toBeNull();
    expect(playlistPath("tidal:tracks:123")).toBeNull();
    expect(playlistPath("file://localhost/C:/Music/a%0Ab.mp3")).toBeNull();
  });
});

describe("buildM3u8", () => {
  it("writes an extended M3U8 in set order with CRLF line ends", () => {
    const { text, skipped } = buildM3u8([entry({}), entry({ title: "I Wish", artist: "", durationSeconds: null, location: "file://localhost/D:/Sets/I%20Wish.wav" })]);
    expect(skipped).toEqual([]);
    expect(text).toBe(
      ["#EXTM3U", "#EXTINF:413,Audion - Moth", "C:\\Users\\dj\\Music\\Moth.mp3", "#EXTINF:-1,I Wish", "D:\\Sets\\I Wish.wav", ""].join("\r\n"),
    );
  });

  it("comments out tracks without a path and reports them", () => {
    const missing = entry({ title: "Upload\nOnly", location: null });
    const { text, skipped } = buildM3u8([missing, entry({})]);
    expect(skipped).toEqual([missing]);
    expect(text.split("\r\n")).toEqual(["#EXTM3U", "# Skipped, no Rekordbox file path: Audion - Upload Only", "#EXTINF:413,Audion - Moth", "C:\\Users\\dj\\Music\\Moth.mp3", ""]);
  });

  it("repeats a track that appears twice in the set", () => {
    const { text } = buildM3u8([entry({}), entry({})]);
    expect(text.match(/Moth\.mp3/g)).toHaveLength(2);
  });
});
