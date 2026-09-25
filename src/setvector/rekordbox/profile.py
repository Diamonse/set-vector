"""What each Rekordbox version is known to import, measured with scripts/rekordbox_probe.py."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CapabilityProfile:
    """Import behaviour measured for ``versions``; ``None`` means not measured.

    ``reimport`` describes a track imported again: ``replace``, ``merge`` or ``ignore``.
    """

    versions: tuple[str, ...]
    hot_cue_slots: int
    memory_cue_limit: int
    memory_cue_colours: bool | None
    reimport: str | None
    grids_survive_analysis: bool | None

    @property
    def verified(self) -> bool:
        """Whether the probe has qualified at least one Rekordbox version."""
        return bool(self.versions)


UNVERIFIED = CapabilityProfile((), 8, 10, None, None, None)
PROFILES: tuple[CapabilityProfile, ...] = ()


def profile_for(version: str | None) -> CapabilityProfile:
    """Return the measured profile for ``version``, or the unverified default."""
    for profile in PROFILES:
        if version in profile.versions:
            return profile
    return UNVERIFIED
