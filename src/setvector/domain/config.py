"""Explicit signal settings and their stable identity."""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from ._validation import require_fields, validate_version

_FIELDS = {"schema_version", "sample_rate", "frame_length", "hop_length", "channel_policy"}


@dataclass(frozen=True, slots=True)
class AnalysisConfig:
    """Signal settings; ``sample_rate=None`` preserves the source rate.

    Frame and hop lengths are samples at the configured analysis rate.
    These settings do not yet define feature algorithms or an energy model.
    """

    sample_rate: int | None
    frame_length: int
    hop_length: int
    channel_policy: Literal["mono", "preserve"]
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        for name in ("sample_rate", "frame_length", "hop_length"):
            value = getattr(self, name)
            if name == "sample_rate" and value is None:
                continue
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if self.hop_length > self.frame_length:
            raise ValueError("hop_length must not exceed frame_length")
        if self.channel_policy not in ("mono", "preserve"):
            raise ValueError("channel_policy must be 'mono' or 'preserve'")

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "AnalysisConfig":
        """Read a complete configuration, rejecting unknown or missing fields."""
        require_fields(data, _FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return a detached JSON object with every effective setting."""
        return {name: getattr(self, name) for name in sorted(_FIELDS)}

    @property
    def config_id(self) -> str:
        """SHA256 hex digest of UTF-8 JSON with sorted keys and no whitespace."""
        canonical = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
