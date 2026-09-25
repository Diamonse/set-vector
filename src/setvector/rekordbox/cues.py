"""Place SetVector cues on a track without changing the user's cues."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from setvector.domain._validation import finite_number

from .model import HOT_CUE_SLOTS, SETVECTOR_PREFIX, PositionMark, validate_colour
from .profile import CapabilityProfile

_REQUIRED = {"label", "start_seconds", "hot"}
_OPTIONAL = {"kind", "end_seconds", "preferred_slot", "colour"}


@dataclass(frozen=True, slots=True)
class CueRequest:
    """A cue SetVector wants on a track; ``label`` is written after the ``SV `` prefix."""

    label: str
    start_seconds: float
    hot: bool
    kind: str = "cue"
    end_seconds: float | None = None
    preferred_slot: int | None = None
    colour: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.label, str) or not self.label.strip():
            raise ValueError("label must be nonempty text")
        label = self.label.strip()
        if label.startswith(SETVECTOR_PREFIX):
            raise ValueError("label must not start with the SV prefix; it is added when writing")
        object.__setattr__(self, "label", label)
        if type(self.hot) is not bool:
            raise ValueError("hot must be true or false")
        if self.kind not in ("cue", "loop"):
            raise ValueError("kind must be cue or loop")
        start = finite_number(self.start_seconds, "start_seconds")
        if start < 0:
            raise ValueError("start_seconds must be nonnegative")
        object.__setattr__(self, "start_seconds", start)
        if self.kind == "loop":
            if self.end_seconds is None:
                raise ValueError("a loop needs end_seconds after start_seconds")
            end = finite_number(self.end_seconds, "end_seconds")
            if round(end, 3) <= round(start, 3):
                raise ValueError("a loop needs end_seconds at least 1 ms after start_seconds")
            object.__setattr__(self, "end_seconds", end)
        elif self.end_seconds is not None:
            raise ValueError("only loops have end_seconds")
        if self.preferred_slot is not None:
            if not self.hot:
                raise ValueError("preferred_slot needs a hot cue")
            if type(self.preferred_slot) is not int or not 0 <= self.preferred_slot < HOT_CUE_SLOTS:
                raise ValueError("preferred_slot must be from 0 to 7")
        object.__setattr__(self, "colour", validate_colour(self.colour))

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "CueRequest":
        """Read one request from JSON; unknown fields are errors."""
        if not isinstance(data, Mapping):
            raise ValueError("a cue request must be an object")
        missing = _REQUIRED - data.keys()
        unknown = data.keys() - _REQUIRED - _OPTIONAL
        if missing:
            raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
        if unknown:
            raise ValueError(f"unknown fields: {', '.join(sorted(map(str, unknown)))}")
        return cls(**data)


@dataclass(frozen=True, slots=True)
class CueOutcome:
    """What happened to one request: ``placed``, ``moved_slot``, ``no_free_slot`` or
    ``over_memory_limit``."""

    request: CueRequest
    status: str
    slot: int | None


@dataclass(frozen=True, slots=True)
class CuePlacement:
    """A track's final marks and one outcome per request."""

    marks: tuple[PositionMark, ...]
    outcomes: tuple[CueOutcome, ...]


def place_cues(
    existing: Sequence[PositionMark],
    requests: Sequence[CueRequest],
    profile: CapabilityProfile,
) -> CuePlacement:
    """Replace every SetVector mark with ``requests``, keeping user marks unchanged.

    Hot cues take their preferred slot when free, otherwise the lowest free slot; slots
    held by SetVector marks count as free. Times are rounded to milliseconds, the
    precision Rekordbox exports.
    """
    user = [mark for mark in existing if not mark.is_setvector]
    taken = {mark.slot for mark in user if mark.slot is not None}
    memory_count = sum(mark.slot is None for mark in user)
    added: list[PositionMark] = []
    outcomes: list[CueOutcome] = []
    for request in requests:
        if request.hot:
            free = [slot for slot in range(profile.hot_cue_slots) if slot not in taken]
            if not free:
                outcomes.append(CueOutcome(request, "no_free_slot", None))
                continue
            if request.preferred_slot is None or request.preferred_slot in free:
                slot = free[0] if request.preferred_slot is None else request.preferred_slot
                status = "placed"
            else:
                slot, status = free[0], "moved_slot"
            taken.add(slot)
        else:
            if memory_count >= profile.memory_cue_limit:
                outcomes.append(CueOutcome(request, "over_memory_limit", None))
                continue
            memory_count += 1
            slot, status = None, "placed"
        keep_colour = request.hot or profile.memory_cue_colours is not False
        added.append(
            PositionMark(
                SETVECTOR_PREFIX + request.label,
                request.kind,
                round(request.start_seconds, 3),
                None if request.end_seconds is None else round(request.end_seconds, 3),
                slot,
                request.colour if keep_colour else None,
            )
        )
        outcomes.append(CueOutcome(request, status, slot))
    return CuePlacement(tuple(user + added), tuple(outcomes))
