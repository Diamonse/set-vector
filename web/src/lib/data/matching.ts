// One rule for "is this the same recording?" when there is no audio fingerprint to compare:
// the Rekordbox import and browser analysis both use it, in whichever order they run.

/** Rekordbox `TotalTime` is whole seconds; a decoded or typed duration may differ slightly. */
export const DURATION_TOLERANCE_SECONDS = 2;

export const normName = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export interface NamedTrack {
  title: string;
  artist: string;
  duration_seconds: number | string;
}

export function closeDuration(track: NamedTrack, seconds: number): boolean {
  return Math.abs(Number(track.duration_seconds) - seconds) <= DURATION_TOLERANCE_SECONDS;
}

/** The single track with this title, artist and length, or null when none or several match. */
export function uniqueTwin<T extends NamedTrack>(candidates: T[], title: string, artist: string, seconds: number): T | null {
  const matches = candidates.filter((c) => normName(c.title) === normName(title) && normName(c.artist) === normName(artist) && closeDuration(c, seconds));
  return matches.length === 1 ? matches[0]! : null;
}
