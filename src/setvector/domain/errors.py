"""Expected failures raised by SetVector's local workflows."""


class SetVectorError(Exception):
    """Base class for expected SetVector failures."""


class InputError(SetVectorError):
    """The caller supplied an invalid path, format, or configuration."""


class UnsupportedAudioError(InputError):
    """The local decoder cannot inspect the supplied audio content."""


class DecodeError(SetVectorError):
    """A supported audio asset could not be decoded."""


class AnalysisError(SetVectorError):
    """Feature extraction failed for decoded audio."""


class ArtifactError(SetVectorError):
    """A local artifact is incomplete, corrupt, or incompatible."""


class InstallationError(SetVectorError):
    """A required part of the SetVector installation is missing or altered."""
