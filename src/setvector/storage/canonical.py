"""Canonical JSON encoding and content-derived artifact identities."""

import hashlib
import json
from collections.abc import Mapping

from setvector.domain import ExtractorIdentity


def canonical_json(value: Mapping[str, object]) -> bytes:
    """Encode JSON with sorted keys, no whitespace, UTF-8, and no NaN or infinity."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _unique_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields: dict[str, object] = {}
    for key, value in pairs:
        if key in fields:
            raise ValueError(f"duplicate field: {key}")
        fields[key] = value
    return fields


def _reject_constant(name: str) -> object:
    raise ValueError(f"unsupported JSON number: {name}")


def strict_json_loads(text: str) -> object:
    """Parse JSON, rejecting duplicate object keys and NaN or infinity literals."""
    return json.loads(text, object_pairs_hook=_unique_fields, parse_constant=_reject_constant)


def compute_feature_id(asset_id: str, extractor: ExtractorIdentity) -> str:
    """SHA-256 of the asset identity and every extractor input, excluding paths."""
    payload = {"asset_id": asset_id, "extractor": extractor.to_dict()}
    return hashlib.sha256(canonical_json(payload)).hexdigest()
