import { describe, expect, it } from "vitest";
import { analyzeAudio } from "@/lib/analysis/analyze";
import type { BeatRunner } from "@/lib/analysis/beat-model";
import { readId3, tagsFor } from "@/lib/analysis/metadata";
import { club } from "./signals";

describe("analyzeAudio without the model", () => {
  const sr = 44100;
  const mono = club(sr, 75, 124);
  const stages = new Set<string>();

  it("produces a reliable fallback grid, tempo, key, loudness, and cue suggestions", async () => {
    const r = await analyzeAudio({ channels: [mono, mono], sampleRate: sr, beatRunner: null, model: null, onProgress: (p) => stages.add(p.stage) });
    expect(r.rhythm.chosen).toBe("setvector_fallback");
    expect(r.rhythm.modelAvailable).toBe(false);
    expect(r.rhythm.downbeats).toEqual([]);
    expect(r.tempo.source).toBe("fallback_grid");
    expect(Math.abs(r.tempo.bpm! - 124)).toBeLessThan(0.5);
    expect(r.tempo.alternatives).toContain(Math.round(r.tempo.bpm! * 2 * 100) / 100);
    expect(r.key.tonic).toBe(9);
    expect(r.key.mode).toBe("minor");
    expect(r.loudness.integratedLufs).not.toBeNull();
    expect(r.cues.map((c) => c.kind)).toEqual(["entry", "exit"]);
    for (const c of r.cues) {
      expect(c.endSeconds).toBeGreaterThan(c.startSeconds);
      expect(c.endSeconds).toBeLessThanOrEqual(r.durationSeconds);
    }
    expect(r.regionKeys).toHaveLength(2);
    expect(r.waveform.peaks.length).toBe(r.waveform.buckets);
    expect(r.warnings.some((w) => w.includes("model is not available"))).toBe(true);
    expect(JSON.parse(JSON.stringify(r)).tempo.bpm).toBe(r.tempo.bpm);
    expect([...stages]).toEqual(expect.arrayContaining(["features", "tempo", "beats", "key", "loudness", "structure", "done"]));
  }, 60_000);

  it("uses model beats and downbeats when a runner is given", async () => {
    // A stand-in network that fires on every beat of the synthetic track and marks every fourth as a downbeat.
    const period = (60 / 124) * 50;
    const frames = Math.floor((mono.length / sr) * 50) + 1;
    const beat = new Float32Array(frames).fill(-5);
    const down = new Float32Array(frames).fill(-5);
    for (let k = 0; (0.05 * 50 + k * period) < frames - 1; k++) {
      const f = Math.round(0.05 * 50 + k * period);
      beat[f] = 5;
      if (k % 4 === 0) down[f] = 5;
    }
    // Chunks arrive last-first, as frame_logits runs them; replay each chunk's slice.
    const starts: number[] = [];
    for (let s = -6; s < frames - 6; s += 1488) starts.push(s);
    if (frames > 1488) starts[starts.length - 1] = frames - 1494;
    starts.reverse();
    let call = 0;
    const scripted: BeatRunner = async (_chunk, n) => {
      const start = starts[call++]!;
      const b = new Float32Array(n).fill(-5);
      const d = new Float32Array(n).fill(-5);
      for (let i = 0; i < n; i++) {
        const src = start + i;
        if (src >= 0 && src < frames) {
          b[i] = beat[src]!;
          d[i] = down[src]!;
        }
      }
      return { beat: b, downbeat: d };
    };
    const r = await analyzeAudio({ channels: [mono], sampleRate: sr, beatRunner: scripted, model: { name: "test", sha256: "0".repeat(64) } });
    expect(r.rhythm.chosen).toBe("beat_this");
    expect(r.tempo.source).toBe("beat_this_grid");
    expect(Math.abs(r.tempo.bpm! - 124)).toBeLessThan(0.5);
    expect(r.rhythm.downbeats.length).toBeGreaterThan(30);
    expect(r.cues[0]!.startSeconds).toBeCloseTo(r.rhythm.downbeats[0]!, 3);
    expect(r.extractor.model?.name).toBe("test");
  }, 60_000);
});

describe("file metadata", () => {
  it("reads ID3v2.4 title and artist", () => {
    const enc = new TextEncoder();
    const frame = (id: string, text: string) => {
      const body = new Uint8Array([3, ...enc.encode(text)]);
      const size = body.length;
      return new Uint8Array([...enc.encode(id), (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f, 0, 0, ...body]);
    };
    const frames = new Uint8Array([...frame("TIT2", "Chandni"), ...frame("TPE1", "Artist C"), ...frame("TBPM", "125")]);
    const n = frames.length;
    const header = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
    const bytes = new Uint8Array([...header, ...frames, 0xff, 0xfb]).buffer;
    expect(readId3(bytes)).toEqual({ title: "Chandni", artist: "Artist C", bpm: 125 });
  });

  it("falls back to Artist - Title file names", () => {
    expect(tagsFor("Artist A - Warm Room (Extended Mix).mp3", new ArrayBuffer(4))).toMatchObject({ artist: "Artist A", title: "Warm Room (Extended Mix)" });
    expect(tagsFor("untitled_track.wav", new ArrayBuffer(4))).toMatchObject({ artist: "", title: "untitled track" });
  });
});

describe("sample rate sniffing", () => {
  it("reads WAV, FLAC, and MP3 headers", async () => {
    const { sniffSampleRate } = await import("@/lib/analysis/metadata");
    const wav = new ArrayBuffer(44);
    const v = new DataView(wav);
    const put = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    put(0, "RIFF");
    put(8, "WAVE");
    put(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint32(24, 48000, true);
    expect(sniffSampleRate(wav)).toBe(48000);

    const flac = new Uint8Array(42);
    flac.set([0x66, 0x4c, 0x61, 0x43]);
    const rate = 96000;
    flac[18] = (rate >> 12) & 0xff;
    flac[19] = (rate >> 4) & 0xff;
    flac[20] = (rate & 0x0f) << 4;
    expect(sniffSampleRate(flac.buffer)).toBe(96000);

    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffSampleRate(mp3.buffer)).toBe(44100);
    expect(sniffSampleRate(new ArrayBuffer(16))).toBeNull();
  });
});
