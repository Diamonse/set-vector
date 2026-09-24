r"""Record upstream Beat This! 1.1.0 output for the vendored-model parity test.

Importing this file needs only NumPy: the tests load ``drum_pattern`` from it with ``runpy``.
Running it needs upstream Beat This!, which must never enter the project venv. Use a
throwaway venv from the repository root:

    py -3.11 -m venv .venv-upstream
    $upstream = ".venv-upstream\Scripts\python.exe"
    & $upstream -m pip install beat-this==1.1.0 torch==2.14.0 torchaudio==2.11.0
    & $upstream scripts\make_beat_this_reference.py
    Remove-Item -Recurse .venv-upstream

Upstream downloads the ``final0`` checkpoint into its own torch hub cache on first use.
"""

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "tests" / "data" / "beat_this_reference.npz"
REFERENCE_SAMPLE_RATE = 44_100


def drum_pattern(sample_rate=22_050, bpm=120.0, bars=16, start=0.5):
    """Kick on every beat, snare on 2 and 4, off-beat hats, a bass note and crash on bar 1.

    Returns float32 samples, the true beat times, and the true downbeat times.
    """
    period = 60.0 / bpm
    size = int(sample_rate * (start + bars * 4 * period + 1))
    signal = np.zeros(size)
    rng = np.random.default_rng(3)

    def put(sound, at, gain):
        i = int(at * sample_rate)
        signal[i : i + sound.size] += gain * sound[: size - i]

    def decay(seconds, tau):
        return np.exp(-np.arange(int(seconds * sample_rate)) / sample_rate / tau)

    t = np.arange(int(0.2 * sample_rate)) / sample_rate
    kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    snare = rng.standard_normal(int(0.15 * sample_rate)) * decay(0.15, 0.04)
    hat = rng.standard_normal(int(0.04 * sample_rate)) * decay(0.04, 0.01)
    crash = rng.standard_normal(sample_rate) * decay(1.0, 0.3)
    beats = start + np.arange(bars * 4) * period
    for i, beat in enumerate(beats):
        put(kick, beat, 0.9)
        if i % 4 in (1, 3):
            put(snare, beat, 0.5)
        put(hat, beat + period / 2, 0.2)
    bar_t = np.arange(int(4 * period * sample_rate)) / sample_rate
    for j, downbeat in enumerate(beats[::4]):
        root = (55.0, 43.65, 49.0, 41.2)[j % 4]
        put(np.sin(2 * np.pi * root * bar_t) * np.minimum(1, bar_t / 0.01), downbeat, 0.3)
        if j % 4 == 0:
            put(crash, downbeat, 0.3)
    signal = 0.9 * signal / np.abs(signal).max()
    return signal.astype(np.float32), beats, beats[::4]


def main() -> int:
    from beat_this.inference import Audio2Frames
    from beat_this.model.postprocessor import Postprocessor

    samples, _, _ = drum_pattern(sample_rate=REFERENCE_SAMPLE_RATE)
    beat, downbeat = Audio2Frames(checkpoint_path="final0", device="cpu")(
        samples, REFERENCE_SAMPLE_RATE
    )
    beats, downbeats = Postprocessor(type="minimal", fps=50)(beat, downbeat)
    REFERENCE.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        REFERENCE,
        beat_logits=beat.numpy(),
        downbeat_logits=downbeat.numpy(),
        beats=np.asarray(beats, dtype=np.float64),
        downbeats=np.asarray(downbeats, dtype=np.float64),
    )
    print(f"wrote {REFERENCE} ({beat.shape[0]} frames, {len(beats)} beats)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
