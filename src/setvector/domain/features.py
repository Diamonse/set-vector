"""Scalar feature measurements with explicit source-relative timing."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise

from ._validation import finite_number, require_fields, validate_version

_ARRAY_FIELDS = ("timestamps", "values", "validity", "window_starts", "window_ends")
_FIELDS = {"schema_version", "name", "unit", *_ARRAY_FIELDS}


@dataclass(frozen=True, slots=True)
class FeatureSeries:
    """A scalar series with times and window boundaries in seconds.

    Timestamps are strictly increasing and nonnegative. Each timestamp lies
    within its positive-width window; windows may overlap. A missing value is
    ``None`` with validity ``False``. Silence may be a valid zero. Inputs are
    copied into tuples, and empty series are allowed when all arrays are empty.
    """

    name: str
    unit: str
    timestamps: tuple[float, ...]
    values: tuple[float | None, ...]
    validity: tuple[bool, ...]
    window_starts: tuple[float, ...]
    window_ends: tuple[float, ...]
    schema_version: int = 1

    def __post_init__(self) -> None:
        validate_version(self.schema_version)
        for field in ("name", "unit"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{field} must be a nonempty string")
        for field in _ARRAY_FIELDS:
            values = getattr(self, field)
            if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
                raise ValueError(f"{field} must be an array")
            object.__setattr__(self, field, tuple(values))
        if len({len(getattr(self, field)) for field in _ARRAY_FIELDS}) != 1:
            raise ValueError("all feature arrays must have matching lengths")
        for field in ("timestamps", "window_starts", "window_ends"):
            numbers = tuple(finite_number(value, field) for value in getattr(self, field))
            if any(value < 0 for value in numbers):
                raise ValueError(f"{field} must contain nonnegative seconds")
            object.__setattr__(self, field, numbers)
        if any(right <= left for left, right in pairwise(self.timestamps)):
            raise ValueError("timestamps must be strictly increasing")
        for time, start, end in zip(
            self.timestamps, self.window_starts, self.window_ends, strict=True
        ):
            if start >= end or not start <= time <= end:
                raise ValueError("each timestamp must lie within a positive-width window")
        normalized = []
        for value, valid in zip(self.values, self.validity, strict=True):
            if type(valid) is not bool:
                raise ValueError("validity must contain booleans")
            if (value is not None) != valid:
                raise ValueError("values must be None exactly where validity is False")
            normalized.append(finite_number(value, "values") if valid else None)
        object.__setattr__(self, "values", tuple(normalized))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "FeatureSeries":
        """Read a complete versioned scalar series."""
        require_fields(data, _FIELDS)
        return cls(**data)

    def to_dict(self) -> dict[str, object]:
        """Return a JSON object whose arrays cannot mutate this series."""
        return {
            "schema_version": self.schema_version,
            "name": self.name,
            "unit": self.unit,
            **{field: list(getattr(self, field)) for field in _ARRAY_FIELDS},
        }
