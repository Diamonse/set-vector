"""Shared validation for the JSON contract boundary."""

from collections.abc import Mapping
from math import isfinite


def require_fields(data: Mapping[str, object], expected: set[str]) -> None:
    if not isinstance(data, Mapping):
        raise ValueError("expected a JSON object")
    missing = expected - data.keys()
    unknown = data.keys() - expected
    if missing:
        raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"unknown fields: {', '.join(sorted(map(str, unknown)))}")


def validate_version(version: int) -> None:
    if type(version) is not int or version != 1:
        raise ValueError("schema_version must be the supported integer version 1")


def finite_number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must contain finite numbers")
    try:
        result = float(value)
    except OverflowError as error:
        raise ValueError(f"{field} must contain finite numbers") from error
    if not isfinite(result):
        raise ValueError(f"{field} must contain finite numbers")
    return result
