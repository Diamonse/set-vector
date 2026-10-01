/** Expand Rekordbox tempo markers into a beat grid. A port of `setvector.rekordbox.grid.expand_tempo`. */
import { beatsPerBar, type TempoMarker } from "./read";

export const MAX_BEATS_PER_MARKER = 200_000;

export interface ExpandedGrid {
  beats: number[];
  /** Beat number within the bar, from 1. */
  positions: number[];
}

/**
 * Each marker is a beat anchor. Beats advance by `60 / bpm` to the next marker or the end,
 * and the bar position advances modulo the meter; a later marker resets both. A beat
 * predicted within a quarter of the local interval (at most 120 ms) before the next marker
 * is dropped, because Rekordbox rounds anchors to milliseconds. Nothing is extrapolated
 * before the first marker.
 */
export function expandTempo(markers: readonly TempoMarker[], durationSeconds: number): ExpandedGrid {
  if (!Number.isFinite(durationSeconds)) throw new Error("duration_seconds must be a finite number");
  const ordered = markers
    .map((marker, index) => ({ marker, index }))
    .sort((a, b) => a.marker.startSeconds - b.marker.startSeconds || a.index - b.index)
    .map((m) => m.marker);
  const beats: number[] = [];
  const positions: number[] = [];
  ordered.forEach((marker, index) => {
    const interval = 60 / marker.bpm;
    let end = durationSeconds;
    const following = ordered[index + 1];
    if (following) {
      const guard = Math.min(0.12, interval * 0.25, (60 / following.bpm) * 0.25);
      end = Math.min(durationSeconds, following.startSeconds - guard);
    }
    if (marker.startSeconds >= end) return;
    const count = Math.ceil((end - marker.startSeconds - 1e-9) / interval);
    if (count > MAX_BEATS_PER_MARKER) {
      throw new Error(
        `the tempo marker at ${marker.startSeconds} s (${marker.bpm} BPM) would expand to more than ${MAX_BEATS_PER_MARKER} beats`,
      );
    }
    const perBar = beatsPerBar(marker);
    for (let step = 0; step < count; step++) {
      const beat = marker.startSeconds + step * interval;
      if (beat >= end - 1e-9) continue;
      const position = ((marker.beatInBar - 1 + step) % perBar) + 1;
      if (beats.length && beat - beats[beats.length - 1]! < 0.001) {
        beats[beats.length - 1] = beat;
        positions[positions.length - 1] = position;
      } else {
        beats.push(beat);
        positions.push(position);
      }
    }
  });
  return { beats, positions };
}

/** Beats and bar lines (position 1) for display. */
export function gridForDisplay(markers: readonly TempoMarker[], durationSeconds: number): { beats: number[]; downbeats: number[] } {
  const { beats, positions } = expandTempo(markers, durationSeconds);
  return { beats, downbeats: beats.filter((_, i) => positions[i] === 1) };
}
