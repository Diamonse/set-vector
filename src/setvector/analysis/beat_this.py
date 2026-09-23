"""Beat This! beat and downbeat detection from the bundled checkpoint.

This is the only module that imports PyTorch or Beat This!, and it does so lazily.
The checkpoint loads only from the package after its SHA-256 matches, so Beat This!'s
download fallback (used when a checkpoint path does not exist) is never reached.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from setvector.domain import AnalysisError, InstallationError
from setvector.models import checkpoint

FPS = 50


@dataclass(frozen=True, slots=True)
class Detection:
    """Beat and downbeat times in seconds from one detector run."""

    beats: np.ndarray
    downbeats: np.ndarray


def verify_checkpoint(path: Path | None = None) -> Path:
    """Return the bundled checkpoint path after checking it exists and matches its hash."""
    path = checkpoint.PATH if path is None else path
    if not path.is_file():
        raise InstallationError(
            f"the Beat This! checkpoint is missing: {path}. Reinstall SetVector, or in a "
            "source checkout run: python scripts/fetch_model.py"
        )
    actual = checkpoint.sha256_file(path)
    if actual != checkpoint.SHA256:
        raise InstallationError(
            f"the Beat This! checkpoint at {path} has SHA-256 {actual}, expected "
            f"{checkpoint.SHA256}. Reinstall SetVector, or rerun scripts/fetch_model.py"
        )
    return path


@lru_cache(maxsize=1)
def _frames_model(path: str):
    from beat_this.inference import Audio2Frames

    return Audio2Frames(checkpoint_path=path, device="cpu")


def refine_peak_times(times, activation, fps: int = FPS) -> np.ndarray:
    """Move each peak-frame time to the vertex of a parabola through its neighbours.

    Times whose frame is at an edge or is not a strict local maximum are unchanged.
    """
    activation = np.asarray(activation, dtype=np.float64)
    refined = np.array(times, dtype=np.float64)
    for i, time in enumerate(refined):
        frame = int(round(time * fps))
        if not 0 < frame < activation.size - 1:
            continue
        left, peak, right = activation[frame - 1 : frame + 2]
        if peak <= left or peak <= right:
            continue
        offset = 0.5 * (left - right) / (left - 2 * peak + right)
        refined[i] = (frame + float(np.clip(offset, -0.5, 0.5))) / fps
    return refined


def detect(samples: np.ndarray, sample_rate: int) -> Detection:
    """Run Beat This! on mono samples; return refined beats and its downbeats."""
    path = verify_checkpoint()
    try:
        from beat_this.model.postprocessor import Postprocessor
    except ImportError as error:
        raise InstallationError(f"Beat This! is not installed correctly: {error}") from error
    try:
        model = _frames_model(str(path))
        beat_logits, downbeat_logits = model(np.asarray(samples, dtype=np.float32), sample_rate)
        beats, downbeats = Postprocessor(type="minimal", fps=FPS)(beat_logits, downbeat_logits)
        activation = beat_logits.detach().cpu().numpy()
    except Exception as error:
        raise AnalysisError(f"Beat This! detection failed: {error}") from error
    return Detection(
        beats=refine_peak_times(beats, activation),
        downbeats=np.asarray(downbeats, dtype=np.float64),
    )
