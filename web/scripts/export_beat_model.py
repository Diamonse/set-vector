"""Export the CLI's Beat This! network to ONNX for the browser, with a hash manifest.

Run from the repository root in the CLI's environment (PyTorch, NumPy) plus ``onnx`` and
``onnxruntime``:

    PYTHONPATH=src python web/scripts/export_beat_model.py            # verified final0 weights
    PYTHONPATH=src python web/scripts/export_beat_model.py --random-weights 0 --out /tmp/beat.onnx

The default uses the weights the CLI verified with ``scripts/fetch_model.py``. Random weights
exist only to test the export path and the browser pipeline; they detect nothing.
Every export is checked against PyTorch with ONNX Runtime on a full 1,500-frame chunk and a
short chunk before the manifest is written.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from setvector.analysis.beat_this import _inference, verify_weights
from setvector.analysis.beat_this._model import BeatThis
from setvector.models import weights

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "public" / "models" / "beat_this-final0.onnx"
TOLERANCE = 1e-3


class _Logits(torch.nn.Module):
    """Returns the two logit tensors as outputs instead of a dict."""

    def __init__(self, model: BeatThis):
        super().__init__()
        self.model = model

    def forward(self, spect: torch.Tensor):
        out = self.model(spect)
        return out["beat"], out["downbeat"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load(random_seed: int | None) -> tuple[BeatThis, str]:
    if random_seed is not None:
        torch.manual_seed(random_seed)
        return BeatThis().eval(), f"random-seed-{random_seed}"
    path = verify_weights()
    with np.load(path, allow_pickle=False) as data:
        arrays = {name: data[name] for name in data.files}
    return _inference.load_model(arrays), weights.SHA256


def _check(model: torch.nn.Module, onnx_path: Path) -> float:
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    worst = 0.0
    generator = torch.Generator().manual_seed(1)
    for frames in (_inference.CHUNK_FRAMES, 700, 112):
        spect = torch.rand((1, frames, _inference.N_MELS), generator=generator) * 6
        with torch.inference_mode():
            expected = [t.numpy() for t in model(spect)]
        actual = session.run(["beat", "downbeat"], {"spect": spect.numpy()})
        for e, a in zip(expected, actual, strict=True):
            worst = max(worst, float(np.abs(e - a).max()))
    return worst


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--random-weights", type=int, metavar="SEED", default=None)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    model, source = _load(args.random_weights)
    wrapped = _Logits(model).eval()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    example = torch.zeros((1, _inference.CHUNK_FRAMES, _inference.N_MELS))
    torch.onnx.export(
        wrapped,
        (example,),
        str(args.out),
        input_names=["spect"],
        output_names=["beat", "downbeat"],
        dynamic_axes={"spect": {1: "frames"}, "beat": {1: "frames"}, "downbeat": {1: "frames"}},
        opset_version=args.opset,
        dynamo=False,
    )
    worst = _check(wrapped, args.out)
    if worst > TOLERANCE:
        args.out.unlink()
        raise SystemExit(f"ONNX output differs from PyTorch by {worst:.2e} (limit {TOLERANCE}); export removed")

    manifest = {
        "name": weights.NAME if args.random_weights is None else "beat_this-random",
        "file": args.out.name,
        "sha256": _sha256(args.out),
        "sourceWeights": source,
        "upstream": f"beat-this {weights.UPSTREAM_VERSION} ({weights.UPSTREAM_COMMIT})",
        "opset": args.opset,
        "torch": torch.__version__,
        "maxAbsDifference": worst,
        "input": {"name": "spect", "shape": [1, "frames", _inference.N_MELS], "maxFrames": _inference.CHUNK_FRAMES},
        "outputs": ["beat", "downbeat"],
    }
    manifest_path = args.out.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB), max |ONNX - PyTorch| = {worst:.2e}")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()
