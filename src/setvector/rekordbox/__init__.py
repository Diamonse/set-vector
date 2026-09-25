"""Rekordbox XML exchange: read collection exports and write importable projections."""

from .cues import CueOutcome, CuePlacement, CueRequest, place_cues
from .grid import expand_tempo, tempo_markers_for
from .model import (
    HOT_CUE_SLOTS,
    SETVECTOR_PREFIX,
    PositionMark,
    RekordboxLibrary,
    RekordboxTrack,
    TempoMarker,
    location_for_path,
    path_from_location,
    validate_colour,
)
from .profile import PROFILES, UNVERIFIED, CapabilityProfile, profile_for
from .read import parse_library, read_library

__all__ = [
    "HOT_CUE_SLOTS",
    "PROFILES",
    "SETVECTOR_PREFIX",
    "UNVERIFIED",
    "CapabilityProfile",
    "CueOutcome",
    "CuePlacement",
    "CueRequest",
    "PositionMark",
    "RekordboxLibrary",
    "RekordboxTrack",
    "TempoMarker",
    "expand_tempo",
    "location_for_path",
    "parse_library",
    "path_from_location",
    "place_cues",
    "profile_for",
    "read_library",
    "tempo_markers_for",
    "validate_colour",
]
