"""Generated, redistributable audio fixtures shared by workflow tests."""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from setvector.domain import AnalysisConfig

SAMPLE_RATE = 8_000


def write_click_tone(path: Path, seconds: float = 3.0, tone_hz: float = 220.0) -> Path:
    """Write a quiet tone with a click every half second as 16-bit WAV."""
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    signal = 0.1 * np.sin(2 * np.pi * tone_hz * t)
    for start in range(0, t.size, SAMPLE_RATE // 2):
        signal[start : start + 40] += 0.8 * np.hanning(40)[: t.size - start]
    sf.write(path, signal.astype(np.float32), SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return path


@pytest.fixture
def click_tone_writer():
    return write_click_tone


@pytest.fixture
def config():
    return AnalysisConfig(sample_rate=None, frame_length=512, hop_length=256, channel_policy="mono")


@pytest.fixture
def tone_path(tmp_path):
    directory = tmp_path / "música library"
    directory.mkdir()
    return write_click_tone(directory / "click tone ドラム.wav")


@pytest.fixture
def config_path(tmp_path, config):
    path = tmp_path / "analysis config.json"
    path.write_text(json.dumps(config.to_dict()), encoding="utf-8")
    return path
