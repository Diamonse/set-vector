// M3U8 playlists that Rekordbox's File > Import > Import Playlist accepts.
// Each entry is the absolute path of a file; Rekordbox adds files it does not hold yet.

import { pathFromLocation } from "./read";

export interface PlaylistEntry {
  title: string;
  artist: string;
  durationSeconds: number | null;
  /** The Rekordbox Location URI, or null when the track has no Rekordbox link. */
  location: string | null;
}

export interface Playlist {
  text: string;
  /** Entries left out because they have no local file path. */
  skipped: PlaylistEntry[];
}

const LINE_BREAK = /[\r\n]+/g;
const HAS_LINE_BREAK = /[\r\n]/;

/** The local path a playlist line needs: native separators for drive paths, null for streaming or missing locations. */
export function playlistPath(location: string | null): string | null {
  if (!location) return null;
  const path = pathFromLocation(location);
  if (!path || HAS_LINE_BREAK.test(path)) return null;
  return /^[A-Za-z]:\//.test(path) ? path.replace(/\//g, "\\") : path;
}

function label(entry: PlaylistEntry): string {
  const text = entry.artist ? `${entry.artist} - ${entry.title}` : entry.title;
  return text.replace(LINE_BREAK, " ");
}

/** Builds an extended M3U8 in set order; entries without a path become comments so the gap stays visible. */
export function buildM3u8(entries: PlaylistEntry[]): Playlist {
  const lines = ["#EXTM3U"];
  const skipped: PlaylistEntry[] = [];
  for (const entry of entries) {
    const path = playlistPath(entry.location);
    if (!path) {
      skipped.push(entry);
      lines.push(`# Skipped, no Rekordbox file path: ${label(entry)}`);
      continue;
    }
    const seconds = entry.durationSeconds !== null && entry.durationSeconds > 0 ? Math.round(entry.durationSeconds) : -1;
    lines.push(`#EXTINF:${seconds},${label(entry)}`, path);
  }
  return { text: lines.join("\r\n") + "\r\n", skipped };
}
