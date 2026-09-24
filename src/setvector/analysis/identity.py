"""Identity of the baseline extractor and the environment that runs it."""

from importlib.metadata import PackageNotFoundError, version

from setvector.domain import AnalysisConfig, ExtractorIdentity, InstallationError
from setvector.models import weights

EXTRACTOR_NAME = "baseline-v1"
ALGORITHM_VERSION = 3
BASS_CUTOFF_HZ = 250.0
# Beat tracking follows the kick: full-band flux locks to off-beat hi-hats in club music.
BEAT_ONSET_BAND_HZ = 150.0
# librosa's default trimming drops quieter intro and outro beats, where DJs mix.
BEAT_TRIM = False
PARAMETERS = {
    "bass_cutoff_hz": BASS_CUTOFF_HZ,
    "beat_onset_band_hz": BEAT_ONSET_BAND_HZ,
    "beat_trim": BEAT_TRIM,
    "spectral_window": "hann",
    "onset_method": "positive_spectral_flux",
    "onset_normalization": "track_peak",
    "resampler": "soxr_hq_when_requested",
}
DEPENDENCIES = ("numpy", "scipy", "soundfile", "librosa", "soxr")

# Rhythm grid fitting (see analysis/grid.py).
GRID_TOLERANCE_SECONDS = 0.04
GRID_ACCEPT_FRACTION = 0.90
GRID_MIN_SPLIT_BEATS = 32
GRID_MAX_SEGMENTS = 8


def baseline_identity(config: AnalysisConfig) -> ExtractorIdentity:
    """Describe every input that can change baseline measurements for ``config``."""
    return ExtractorIdentity(
        name=EXTRACTOR_NAME,
        algorithm_version=ALGORITHM_VERSION,
        package_version=version("setvector"),
        config=config,
        parameters=PARAMETERS,
        dependency_versions={name: version(name) for name in DEPENDENCIES},
    )


# Rhythm candidate acceptance (see analysis/rhythm.py). Provisional until measured
# against reviewed Rekordbox grids.
RHYTHM_EXTRACTOR_NAME = "rhythm-v1"
RHYTHM_ALGORITHM_VERSION = 1
MIN_BEATS = 32
MAX_INTERVAL_CV = 0.15
# Longer intervals are missed-beat gaps, which grid_fit measures instead.
INTERVAL_GAP_RATIO = 1.5
MIN_GRID_FIT = 0.90
MIN_BAR_REGULARITY = 0.75
BAR_LENGTHS = (3, 4)
BAR_PHASE_CONFIRM = 4
MIN_DETECTION_SECONDS = 1.0
RHYTHM_PARAMETERS = {
    "model": weights.NAME,
    "upstream": f"beat-this {weights.UPSTREAM_VERSION} ({weights.UPSTREAM_COMMIT})",
    "weights_sha256": weights.SHA256,
    "postprocessor": "minimal",
    "peak_refinement": "parabolic",
    "grid_tolerance_seconds": GRID_TOLERANCE_SECONDS,
    "grid_accept_fraction": GRID_ACCEPT_FRACTION,
    "grid_min_split_beats": GRID_MIN_SPLIT_BEATS,
    "grid_max_segments": GRID_MAX_SEGMENTS,
    "min_beats": MIN_BEATS,
    "max_interval_cv": MAX_INTERVAL_CV,
    "interval_gap_ratio": INTERVAL_GAP_RATIO,
    "min_grid_fit": MIN_GRID_FIT,
    "min_bar_regularity": MIN_BAR_REGULARITY,
    "bar_lengths": ",".join(map(str, BAR_LENGTHS)),
    "bar_phase_confirm": BAR_PHASE_CONFIRM,
    "min_detection_seconds": MIN_DETECTION_SECONDS,
}
RHYTHM_DEPENDENCIES = (
    "einops",
    "librosa",
    "numpy",
    "rotary-embedding-torch",
    "scipy",
    "soxr",
    "torch",
)


def _dependency_version(name: str) -> str:
    """Return the installed version of ``name``, or raise ``InstallationError`` when absent."""
    try:
        return version(name)
    except PackageNotFoundError as error:
        raise InstallationError(
            f"the rhythm engine needs the '{name}' package, which is not installed. "
            "Reinstall SetVector with its runtime dependencies."
        ) from error


def rhythm_identity(baseline: ExtractorIdentity) -> ExtractorIdentity:
    """Describe every input that can change the rhythm derived from ``baseline`` features."""
    return ExtractorIdentity(
        name=RHYTHM_EXTRACTOR_NAME,
        algorithm_version=RHYTHM_ALGORITHM_VERSION,
        package_version=version("setvector"),
        config=baseline.config,
        parameters=RHYTHM_PARAMETERS,
        dependency_versions={name: _dependency_version(name) for name in RHYTHM_DEPENDENCIES},
    )
