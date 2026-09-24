"""Beat This! inference, vendored from upstream 1.1.0 (commit b95c8ab) under the MIT license.

Adapted from ``beat_this/inference.py``, ``preprocessing.py``, and ``model/postprocessor.py``
(see ``setvector/models/LICENSE-beat-this``). The log-mel front end uses ``torch.stft`` and
librosa's filterbank instead of torchaudio, weights arrive as NumPy arrays instead of a
pickled checkpoint, peak picking uses SciPy instead of PyTorch, and there is no download path.
"""

from functools import cache

import librosa
import numpy as np
import soxr
import torch
import torch.nn.functional as F
from scipy.ndimage import maximum_filter1d

from ._model import BeatThis

FPS = 50
SAMPLE_RATE = 22_050
N_FFT = 1024
HOP_LENGTH = 441
F_MIN = 30.0
F_MAX = 11_000.0
N_MELS = 128
CHUNK_FRAMES = 1500
BORDER_FRAMES = 6
PEAK_WINDOW_FRAMES = 7


def load_model(arrays: dict[str, np.ndarray]) -> BeatThis:
    """Build the default-sized model, as ``final0`` was trained, and load ``arrays`` strictly."""
    model = BeatThis()
    model.load_state_dict({name: torch.from_numpy(a) for name, a in arrays.items()}, strict=True)
    return model.eval()


@cache
def _mel_filterbank() -> torch.Tensor:
    """Slaney-scale triangular filters without area normalization, shape ``(513, 128)``."""
    bank = librosa.filters.mel(
        sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS, fmin=F_MIN, fmax=F_MAX, htk=False, norm=None
    )
    return torch.from_numpy(bank.T.astype(np.float32))


def log_mel(samples: np.ndarray, sample_rate: int) -> torch.Tensor:
    """Return the ``(frames, 128)`` log-mel spectrogram of mono ``samples`` at 50 frames/s."""
    samples = np.asarray(samples, dtype=np.float32)
    if sample_rate != SAMPLE_RATE:
        samples = soxr.resample(samples, in_rate=sample_rate, out_rate=SAMPLE_RATE)
    magnitude = torch.stft(
        torch.from_numpy(np.ascontiguousarray(samples)),
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        window=torch.hann_window(N_FFT),
        center=True,
        pad_mode="reflect",
        normalized=True,  # torchaudio's normalized="frame_length"
        onesided=True,
        return_complex=True,
    ).abs()
    return torch.log1p(1000 * (magnitude.T @ _mel_filterbank()))


def frame_logits(model: BeatThis, spect: torch.Tensor) -> tuple[np.ndarray, np.ndarray]:
    """Return per-frame beat and downbeat logits for a whole ``(frames, 128)`` spectrogram.

    The model sees 1,500-frame chunks overlapping by ``BORDER_FRAMES``. Border predictions
    are discarded and the earlier chunk wins each overlap, as upstream's
    ``split_predict_aggregate(overlap_mode="keep_first")``. Chunks run one at a time: batching
    them was no faster on CPU and doubled peak memory.
    """
    size = len(spect)
    step = CHUNK_FRAMES - 2 * BORDER_FRAMES
    starts = np.arange(-BORDER_FRAMES, size - BORDER_FRAMES, step)
    if size > step:
        starts[-1] = size - (CHUNK_FRAMES - BORDER_FRAMES)
    beat = torch.full((size,), -1000.0)
    downbeat = torch.full((size,), -1000.0)
    with torch.inference_mode():
        for start in starts[::-1]:  # later chunks first, so earlier ones overwrite overlaps
            chunk = F.pad(
                spect[max(start, 0) : min(start + CHUNK_FRAMES, size)],
                (0, 0, max(0, -start), max(0, min(BORDER_FRAMES, start + CHUNK_FRAMES - size))),
            )
            prediction = model(chunk.unsqueeze(0))
            keep = slice(start + BORDER_FRAMES, start + CHUNK_FRAMES - BORDER_FRAMES)
            beat[keep] = prediction["beat"][0, BORDER_FRAMES:-BORDER_FRAMES]
            downbeat[keep] = prediction["downbeat"][0, BORDER_FRAMES:-BORDER_FRAMES]
    return beat.numpy(), downbeat.numpy()


def _peak_frames(logits: np.ndarray) -> np.ndarray:
    """Frames that are the maximum within ±3 frames with probability above 0.5.

    Adjacent peak frames are merged into their mean frame, as upstream's ``deduplicate_peaks``.
    """
    peaks = np.flatnonzero(
        (logits == maximum_filter1d(logits, PEAK_WINDOW_FRAMES, mode="constant", cval=-np.inf))
        & (logits > 0)
    )
    if peaks.size == 0:
        return peaks.astype(np.float64)
    groups = np.split(peaks, np.flatnonzero(np.diff(peaks) > 1) + 1)
    return np.array([group.mean() for group in groups])


def pick_peaks(beat: np.ndarray, downbeat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Upstream's minimal postprocessor: beat and downbeat times in seconds.

    Each downbeat moves to its nearest beat, and duplicates are removed.
    """
    beats = _peak_frames(beat) / FPS
    downbeats = _peak_frames(downbeat) / FPS
    if beats.size and downbeats.size:
        downbeats = np.unique(beats[np.abs(beats[None, :] - downbeats[:, None]).argmin(axis=1)])
    return beats, downbeats
