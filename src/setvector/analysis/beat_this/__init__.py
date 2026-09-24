"""Beat This! beat and downbeat detection from the bundled weights.

This package holds the only PyTorch code in SetVector, vendored from Beat This! 1.1.0. This
module imports nothing from PyTorch at import time. The weights load only from the package
after their SHA-256 matches, and there is no download path.
"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from setvector.domain import AnalysisError, InstallationError
from setvector.models import weights

FPS = 50


@dataclass(frozen=True, slots=True)
class Detection:
    """Beat and downbeat times in seconds from one detector run."""

    beats: np.ndarray
    downbeats: np.ndarray


def verify_weights(path: Path | None = None) -> Path:
    """Return the bundled weights path after checking it exists and matches its hash."""
    path = weights.PATH if path is None else Path(path)
    if not path.is_file():
        raise InstallationError(
            f"the Beat This! weights are missing: {path}. Reinstall SetVector, or in a "
            "source checkout run: python scripts/fetch_model.py"
        )
    try:
        actual = weights.weights_sha256(path)
    except Exception as error:
        raise InstallationError(
            f"the Beat This! weights at {path} are unreadable ({error}). Reinstall SetVector, "
            "or rerun scripts/fetch_model.py"
        ) from error
    if actual != weights.SHA256:
        raise InstallationError(
            f"the Beat This! weights at {path} have SHA-256 {actual}, expected "
            f"{weights.SHA256}. Reinstall SetVector, or rerun scripts/fetch_model.py"
        )
    return path


@lru_cache(maxsize=1)
def _load(path: str):
    verified = verify_weights(Path(path))
    try:
        from . import _inference

        with np.load(verified, allow_pickle=False) as data:
            arrays = {name: data[name] for name in data.files}
        return _inference.load_model(arrays)
    except Exception as error:
        raise InstallationError(f"the Beat This! model could not be loaded: {error}") from error


def load_model():
    """Return the verified bundled model, loaded once per process."""
    return _load(str(weights.PATH))


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
    model = load_model()
    from . import _inference

    try:
        spect = _inference.log_mel(samples, sample_rate)
        beat_logits, downbeat_logits = _inference.frame_logits(model, spect)
    except Exception as error:
        raise AnalysisError(f"Beat This! detection failed: {error}") from error
    beats, downbeats = _inference.pick_peaks(beat_logits, downbeat_logits)
    return Detection(beats=refine_peak_times(beats, beat_logits), downbeats=downbeats)
