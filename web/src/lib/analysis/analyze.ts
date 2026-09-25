import { detectBeats, type BeatRunner } from "./beat-model";
import { extractBaselineFrames, DEFAULT_BASELINE_CONFIG } from "./features";
import { evaluateCandidate, segmentBpm, type RhythmCandidate } from "./grid";
import { chromagram, estimateKey } from "./key";
import { measureLoudness } from "./loudness";
import { mixToMono, resample } from "./resample";
import { findBoundaries, suggestCues } from "./structure";
import { estimateTempo, trackBeats } from "./tempo";
import {
  EXTRACTOR_NAME,
  EXTRACTOR_VERSION,
  type AnalysisProgress,
  type AnalysisResult,
  type KeyRegionEstimate,
} from "./types";

export const ANALYSIS_SAMPLE_RATE = 22_050;
const MIN_DETECTION_SECONDS = 1;
const WAVEFORM_BUCKETS = 1600;

export interface AnalyzeInput {
  channels: Float32Array[];
  sampleRate: number;
  /** Beat This! runner; null when the model is unavailable. */
  beatRunner: BeatRunner | null;
  model: { name: string; sha256: string } | null;
  onProgress?: (progress: AnalysisProgress) => void;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function mean(values: Float64Array): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]!)) {
      sum += values[i]!;
      n++;
    }
  }
  return n ? sum / n : null;
}

function waveform(mono: Float32Array, sampleRate: number): AnalysisResult["waveform"] {
  const buckets = Math.min(WAVEFORM_BUCKETS, Math.max(1, mono.length));
  const size = mono.length / buckets;
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let p = 0;
    const end = Math.floor((b + 1) * size);
    for (let i = Math.floor(b * size); i < end; i++) p = Math.max(p, Math.abs(mono[i]!));
    peaks.push(p);
    max = Math.max(max, p);
  }
  return {
    buckets,
    secondsPerBucket: size / sampleRate,
    peaks: peaks.map((p) => Math.round((max > 0 ? p / max : 0) * 1000) / 1000),
  };
}

/**
 * Analyze decoded audio: baseline frames, tempo, beat grid (Beat This! first, the DSP
 * tracker as fallback, as the CLI's rhythm engine), key, loudness, section boundaries,
 * and cue suggestions.
 */
export async function analyzeAudio(input: AnalyzeInput): Promise<AnalysisResult> {
  const { channels, sampleRate, beatRunner, onProgress } = input;
  const warnings: string[] = [];
  const report = (stage: AnalysisProgress["stage"], fraction: number) => onProgress?.({ stage, fraction });
  const mono = mixToMono(channels);
  const duration = mono.length / sampleRate;

  report("features", 0);
  const frames = extractBaselineFrames(mono, sampleRate, DEFAULT_BASELINE_CONFIG, (f) => report("features", f));
  if (frames.frameCount === 0) warnings.push("the audio is shorter than one analysis frame; no features were measured");

  report("tempo", 0);
  const tempo = estimateTempo(frames.beatOnset, sampleRate, frames.hopLength);
  const fallbackBeats = tempo
    ? trackBeats(frames.beatOnset, tempo.bpm, tempo.framesPerSecond).filter((i) => i < frames.frameCount).map((i) => frames.timestamps[i]!)
    : [];
  report("tempo", 1);

  const mono22 = sampleRate === ANALYSIS_SAMPLE_RATE ? mono : resample(mono, sampleRate, ANALYSIS_SAMPLE_RATE);

  const candidates: RhythmCandidate[] = [];
  if (beatRunner && duration >= MIN_DETECTION_SECONDS) {
    report("beats", 0);
    try {
      const detection = await detectBeats(mono22, ANALYSIS_SAMPLE_RATE, beatRunner, (f) => report("beats", f));
      candidates.push(evaluateCandidate("beat_this", detection.beats, detection.downbeats, duration));
    } catch (error) {
      warnings.push(`Beat This! failed (${(error as Error).message}); the fallback tracker was used`);
    }
  } else if (!beatRunner) {
    warnings.push("the Beat This! model is not available, so downbeats were not detected and the fallback beat tracker was used");
  }
  if (candidates.length === 0 || candidates[0]!.reasons.length) {
    candidates.push(evaluateCandidate("setvector_fallback", fallbackBeats, null, duration));
  }
  const chosen = candidates.find((c) => c.reasons.length === 0) ?? null;
  report("beats", 1);

  const beats = chosen?.fit?.beats ?? [];
  const downbeats = chosen ? beats.filter((_, i) => chosen.barPositions[i] === 1) : [];
  let bpm: number | null = null;
  let source: AnalysisResult["tempo"]["source"] = "none";
  if (chosen?.fit) {
    const longest = chosen.fit.segments.reduce((a, b) => (b.beatCount > a.beatCount ? b : a));
    bpm = segmentBpm(longest);
    source = chosen.name === "beat_this" ? "beat_this_grid" : "fallback_grid";
  } else if (tempo) {
    bpm = tempo.bpm;
    source = "tempogram";
    warnings.push("no reliable beat grid; tempo comes from the tempogram only");
  }
  const alternatives = bpm
    ? [bpm * 2, bpm / 2, ...(tempo?.candidates.filter((c) => c.relation === "peak").map((c) => c.bpm) ?? [])]
        .filter((b) => b >= 40 && b <= 250 && Math.abs(Math.log2(b / bpm!)) > 0.03)
        .slice(0, 4)
        .map((b) => Math.round(b * 100) / 100)
    : [];

  report("key", 0);
  const chroma = chromagram(mono22, ANALYSIS_SAMPLE_RATE);
  const key = estimateKey(chroma);
  report("key", 1);

  report("loudness", 0);
  const loudness = measureLoudness(channels, sampleRate);
  report("loudness", 1);

  report("structure", 0);
  const boundaries = findBoundaries(beats, duration, frames, chroma);
  const cues = suggestCues(beats, downbeats, boundaries, duration);
  const regionKeys: KeyRegionEstimate[] = cues.map((c) => ({
    kind: c.kind,
    startSeconds: c.startSeconds,
    endSeconds: c.endSeconds,
    key: estimateKey(chroma, c.startSeconds, c.endSeconds),
  }));
  report("structure", 1);

  const result: AnalysisResult = {
    extractor: {
      name: EXTRACTOR_NAME,
      version: EXTRACTOR_VERSION,
      parameters: {
        frame_length: frames.frameLength,
        hop_length: frames.hopLength,
        channel_policy: "mono_mean",
        beat_onset_band_hz: 150,
        bass_cutoff_hz: 250,
        tempo_prior_bpm: 120,
        analysis_sample_rate: ANALYSIS_SAMPLE_RATE,
        key_profile: key.profile,
        loudness: "ITU-R BS.1770-4",
        cue_region_beats: 32,
      },
      model: input.model,
    },
    durationSeconds: round3(duration),
    sampleRate,
    channelCount: channels.length,
    tempo: { bpm: bpm === null ? null : Math.round(bpm * 100) / 100, source, candidates: tempo?.candidates ?? [], alternatives },
    rhythm: {
      chosen: chosen?.name ?? null,
      modelAvailable: beatRunner !== null,
      reasons: candidates.flatMap((c) => c.reasons),
      candidates: candidates.map((c) => ({ name: c.name, quality: c.quality, reasons: c.reasons })),
      segments: chosen?.fit?.segments ?? [],
      beats: beats.map(round3),
      downbeats: downbeats.map(round3),
    },
    key,
    regionKeys,
    loudness: {
      integratedLufs: loudness.integratedLufs,
      loudnessRangeLu: loudness.loudnessRangeLu,
      samplePeakDbfs: loudness.samplePeakDbfs,
      shortTerm: loudness.shortTerm.map((v) => (v === null ? null : Math.round(v * 10) / 10)),
    },
    summary: { meanRms: mean(frames.rms) ?? 0, meanCentroidHz: mean(frames.centroid), meanBassRatio: mean(frames.bassRatio) },
    boundaries: boundaries.map((b) => ({ seconds: round3(b.seconds), strength: Math.round(b.strength * 1000) / 1000 })),
    cues,
    waveform: waveform(mono, sampleRate),
    warnings,
  };
  report("done", 1);
  return result;
}
