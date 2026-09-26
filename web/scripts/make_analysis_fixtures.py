"""Generate parity fixtures for the browser analysis port from the CLI's own code.

Run from the repository root with the CLI's dependencies plus pyloudnorm installed:

    PYTHONPATH=src python web/scripts/make_analysis_fixtures.py

Signals are synthesized with the same formulas as ``web/tests/analysis/signals.ts``, so
only small summaries are committed, never audio.
"""

import json
import math
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "analysis"

CHORDS = {  # A minor, D minor, E major, A minor: unambiguous A minor harmony.
    0: (220.0, 261.63, 329.63),
    1: (146.83, 174.61, 220.0),
    2: (164.81, 207.65, 246.94),
    3: (220.0, 261.63, 329.63),
}


def noise(count: int) -> np.ndarray:
    """MINSTD generator mapped to [-1, 1), identical to the TypeScript version."""
    out = np.empty(count)
    x = 1
    for i in range(count):
        x = (48271 * x) % 2147483647
        out[i] = x / 2147483647 * 2 - 1
    return out


def club(sample_rate: int, seconds: float, bpm: float, offset: float = 0.05) -> np.ndarray:
    n = int(round(sample_rate * seconds))
    t = np.arange(n) / sample_rate
    beat = 60.0 / bpm
    signal = np.zeros(n)
    k = 0
    while offset + k * beat < seconds:
        kb = offset + k * beat
        d = t - kb
        m = (d >= 0) & (d < 0.25)
        signal[m] += 0.9 * np.sin(2 * math.pi * 55 * d[m]) * np.exp(-d[m] * 18)
        hb = kb + beat / 2
        d = t - hb
        m = (d >= 0) & (d < 0.06)
        idx = np.flatnonzero(m)
        signal[idx] += 0.15 * noise(idx.size) * np.exp(-d[m] * 60)
        k += 1
    bar = 4 * beat
    chord_index = np.floor(np.maximum(t - offset, 0) / (2 * bar)).astype(int) % 4
    for c, freqs in CHORDS.items():
        m = chord_index == c
        for f in freqs:
            signal[m] += 0.08 * np.sin(2 * math.pi * f * t[m])
    return signal.astype(np.float32)


def every(values, step):
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(values, dtype=np.float64)[::step]]


def baseline_fixture():
    import librosa  # noqa: F401  (imported by the baseline module)

    from setvector.analysis import baseline
    from setvector.domain import AnalysisConfig

    sr = 44_100
    samples = club(sr, 30.0, 124.0)
    config = AnalysisConfig(schema_version=1, sample_rate=None, frame_length=2048, hop_length=512, channel_policy="mono")
    frames = baseline._frame_count(samples.size, 2048, 512)
    rms, centroid, bass, onset, beat_onset = baseline._measure_frames(samples[None, :], sr, config, frames)
    timestamps = [(i * 512 + 1024) / sr for i in range(frames)]
    tempo, beats = baseline._estimate_beats(beat_onset, timestamps, sr, 512)
    return {
        "sampleRate": sr,
        "seconds": 30.0,
        "bpm": 124.0,
        "frameCount": frames,
        "step": 10,
        "rms": every(rms, 10),
        "centroid": every(np.array([np.nan if v is None else v for v in centroid]), 10),
        "bassRatio": every(np.array([np.nan if v is None else v for v in bass]), 10),
        "onset": every(onset, 10),
        "beatOnset": every(beat_onset, 10),
        "tempoBpm": tempo,
        "beatFrames": [b.frame_index for b in beats],
    }


def log_mel_fixture():
    from setvector.analysis.beat_this import _inference

    sr = 22_050
    samples = club(sr, 12.0, 124.0)
    spect = _inference.log_mel(samples, sr).numpy()
    rows = list(range(0, spect.shape[0], 20))
    return {"sampleRate": sr, "seconds": 12.0, "frames": int(spect.shape[0]), "rows": rows, "values": [spect[r].tolist() for r in rows]}


def jitter(i: int) -> float:
    return 0.012 * math.sin(i * 1.7) * math.cos(i * 0.37)


def grid_fixture():
    from setvector.analysis import grid, rhythm

    steady = [0.3 + i * 60 / 124 + jitter(i) for i in range(200) if i % 23 != 5]
    steady += [0.3 + 57.5 * 60 / 124]  # one extra detection between beats
    change = [0.2 + i * 0.5 + jitter(i) for i in range(100)]
    start = change[-1] + 60 / 128
    change += [start + i * 60 / 128 + jitter(i + 100) for i in range(120)]
    downbeats = [t for i, t in enumerate(sorted(steady)) if i % 4 == 1]
    cases = {}
    for name, times, duration, bars in (
        ("steady", steady, 110.0, downbeats),
        ("tempo_change", change, 110.0, None),
    ):
        fit = grid.fit_grid(np.array(times), duration)
        cand = rhythm._evaluate("beat_this" if bars else "setvector_fallback", np.array(times), None if bars is None else np.array(bars), duration)
        cases[name] = {
            "times": times,
            "duration": duration,
            "downbeats": bars,
            "segments": [[s.start_seconds, s.period, s.beat_count] for s in fit.segments],
            "gridFit": fit.grid_fit,
            "quality": {
                "beatCount": cand.quality.beat_count,
                "intervalCv": cand.quality.interval_cv,
                "gridFit": cand.quality.grid_fit,
                "segmentCount": cand.quality.segment_count,
                "modalBarLength": cand.quality.modal_bar_length,
                "barRegularity": cand.quality.bar_regularity,
            },
            "reasons": list(cand.reasons),
            "barPositions": list(cand.bar_positions)[:40],
        }
    return cases


def peaks_fixture():
    from setvector.analysis.beat_this import _inference, refine_peak_times

    n = 1000
    frames = np.arange(n)
    beat = (4 * np.cos(2 * math.pi * frames / 24.2) - 1.5 + 0.3 * np.sin(frames * 0.9)).astype(np.float32)
    down = (4 * np.cos(2 * math.pi * frames / 96.8) - 2.5 + 0.3 * np.sin(frames * 0.5)).astype(np.float32)
    beats, downbeats = _inference.pick_peaks(beat, down)
    return {"frames": n, "beats": beats.tolist(), "downbeats": downbeats.tolist(), "refined": refine_peak_times(beats, beat).tolist()}


def loudness_fixture():
    import pyloudnorm

    sr = 44_100
    left = club(sr, 20.0, 124.0).astype(np.float64)
    right = 0.5 * left
    stereo = np.stack([left, right], axis=1)
    meter = pyloudnorm.Meter(sr)
    t = np.arange(sr * 10) / sr
    amp = 10 ** (-23 / 20)
    sine = np.stack([amp * np.sin(2 * math.pi * 1000 * t)] * 2, axis=1)
    return {
        "sampleRate": sr,
        "clubIntegrated": float(meter.integrated_loudness(stereo)),
        "sineIntegrated": float(meter.integrated_loudness(sine)),
    }


def librosa_tempo_reference():
    import librosa

    out = {}
    for bpm in (90.0, 124.0, 174.0):
        sr = 22_050
        samples = club(sr, 40.0, bpm)
        onset = librosa.onset.onset_strength(y=samples, sr=sr, hop_length=512)
        tempo = librosa.feature.tempo(onset_envelope=onset, sr=sr, hop_length=512)
        out[str(int(bpm))] = float(np.asarray(tempo).reshape(-1)[0])
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "baseline": baseline_fixture(),
        "log_mel": log_mel_fixture(),
        "grid": grid_fixture(),
        "peaks": peaks_fixture(),
        "loudness": loudness_fixture(),
    }
    for name, value in fixtures.items():
        (OUT / f"{name}.json").write_text(json.dumps(value, separators=(",", ":")) + "\n")
        print("wrote", name)


if __name__ == "__main__":
    main()
