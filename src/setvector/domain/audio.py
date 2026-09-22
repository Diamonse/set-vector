"""Immutable metadata for a decoded source audio asset."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from ._validation import finite_number, require_fields, validate_version

_FIELDS = {
    "asset_id",
    "observed_path",
    "byte_size",
    "duration_seconds",
    "native_sample_rate",
    "channels",
    "format",
    "subtype",
    "schema_version",
}
_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


def validate_sha256(value: object, field: str) -> str:
    """Return a lower-case SHA-256 hexadecimal identity."""
    if not isinstance(value, str) or _SHA256_HEX.fullmatch(value) is None:
        raise ValueError(f"{field} must be a lowercase 64-character SHA-256 hex string")
    return value


def positive_integer(value: object, field: str) -> int:
    """Return a non-boolean positive integer."""
    if type(value) is not int or value <= 0:
        raise ValueError(f"{field} must be a positive integer")
    return value


def nonempty_string(value: object, field: str) -> str:
    """Return a non-blank string."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value


@dataclass(frozen=True, slots=True)
class AudioAsset:
    """Content-identified metadata reported by the local decoder."""

    asset_id: str
    observed_path: str
    byte_size: int
    duration_seconds: float
    native_sample_rate: int
    channels: int
    format: str
    subtype: str
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        object.__setattr__(self, "asset_id", validate_sha256(self.asset_id, "asset_id"))
        path = nonempty_string(self.observed_path, "observed_path")
        if not Path(path).is_absolute():
            raise ValueError("observed_path must be absolute")
        object.__setattr__(self, "observed_path", path)
        object.__setattr__(self, "byte_size", positive_integer(self.byte_size, "byte_size"))
        duration = finite_number(self.duration_seconds, "duration_seconds")
        if duration < 0:
            raise ValueError("duration_seconds must be nonnegative")
        object.__setattr__(self, "duration_seconds", duration)
        object.__setattr__(
            self,
            "native_sample_rate",
            positive_integer(self.native_sample_rate, "native_sample_rate"),
        )
        object.__setattr__(self, "channels", positive_integer(self.channels, "channels"))
        object.__setattr__(self, "format", nonempty_string(self.format, "format"))
        object.__setattr__(self, "subtype", nonempty_string(self.subtype, "subtype"))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "AudioAsset":
        """Read complete asset metadata without accepting schema drift."""
        require_fields(data, _FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return detached JSON-compatible asset metadata."""
        return {name: getattr(self, name) for name in sorted(_FIELDS)}
