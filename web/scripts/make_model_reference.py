"""Record PyTorch frame logits for a synthetic track, to test the browser model path.

    PYTHONPATH=src python web/scripts/make_model_reference.py --random-weights 0 --out ref.json

Use the same weights (random seed or verified final0) as the exported ONNX model.
"""

import argparse
import importlib.util
import json
from pathlib import Path

import torch

from setvector.analysis.beat_this import _inference

HERE = Path(__file__).resolve().parent


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--random-weights", type=int, metavar="SEED", default=None)
    parser.add_argument("--seconds", type=float, default=40.0)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    export = _load("export_beat_model")
    fixtures = _load("make_analysis_fixtures")
    model, source = export._load(args.random_weights)
    samples = fixtures.club(_inference.SAMPLE_RATE, args.seconds, 124.0)
    spect = _inference.log_mel(samples, _inference.SAMPLE_RATE)
    beat, downbeat = _inference.frame_logits(model, spect)
    beats, downbeats = _inference.pick_peaks(beat, downbeat)
    args.out.write_text(
        json.dumps(
            {
                "source": source,
                "seconds": args.seconds,
                "frames": int(beat.size),
                "beat": beat.tolist(),
                "downbeat": downbeat.tolist(),
                "beats": beats.tolist(),
                "downbeats": downbeats.tolist(),
            }
        )
    )
    torch.set_num_threads(1)
    print(f"wrote {args.out}: {beat.size} frames, {beats.size} beats")


if __name__ == "__main__":
    main()
