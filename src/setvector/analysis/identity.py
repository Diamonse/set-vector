"""Identity of the baseline extractor and the environment that runs it."""

from importlib.metadata import version

from setvector.domain import AnalysisConfig, ExtractorIdentity

EXTRACTOR_NAME = "baseline-v1"
ALGORITHM_VERSION = 1
BASS_CUTOFF_HZ = 250.0
PARAMETERS = {
    "bass_cutoff_hz": BASS_CUTOFF_HZ,
    "spectral_window": "hann",
    "onset_method": "positive_spectral_flux",
    "onset_normalization": "track_peak",
    "resampler": "soxr_hq_when_requested",
}
DEPENDENCIES = ("numpy", "scipy", "soundfile", "librosa", "soxr")


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
