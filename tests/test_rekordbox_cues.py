"""SetVector cues fill free slots and never change the user's cues."""

from dataclasses import replace

import pytest

from setvector.rekordbox import (
    UNVERIFIED,
    CapabilityProfile,
    CueRequest,
    PositionMark,
    place_cues,
    profile_for,
)
from setvector.rekordbox import profile as profile_module

USER_HOT = PositionMark("", "cue", 10.0, slot=0, colour=(1, 2, 3))
USER_MEMORY = PositionMark("", "cue", 5.0)
OLD_OWN = PositionMark("SV Old", "cue", 20.0, slot=1)
EXISTING = (USER_HOT, USER_MEMORY, OLD_OWN)


def hot(label, slot=None, start=30.0):
    return CueRequest(label, start, True, preferred_slot=slot, colour=(255, 0, 0))


@pytest.mark.parametrize(
    "cue, status, slot",
    [
        (hot("Free", 2), "placed", 2),
        (hot("Taken by user", 0), "moved_slot", 1),
        (hot("Own slot", 1), "placed", 1),
        (hot("Any"), "placed", 1),
    ],
)
def test_hot_cue_slots(cue, status, slot):
    placement = place_cues(EXISTING, (cue,), UNVERIFIED)
    (outcome,) = placement.outcomes
    assert (outcome.status, outcome.slot) == (status, slot)
    assert placement.marks == (
        USER_HOT,
        USER_MEMORY,
        PositionMark("SV " + cue.label, "cue", 30.0, slot=slot, colour=(255, 0, 0)),
    )


def test_a_track_with_every_slot_used_by_the_user_is_reported():
    full = tuple(PositionMark("", "cue", float(i), slot=i) for i in range(8))
    placement = place_cues(full, (hot("Drop"),), UNVERIFIED)
    assert placement.marks == full
    assert (placement.outcomes[0].status, placement.outcomes[0].slot) == ("no_free_slot", None)


def test_hot_cues_without_preference_fill_slots_in_order():
    placement = place_cues(EXISTING, (hot("One"), hot("Two")), UNVERIFIED)
    assert [outcome.slot for outcome in placement.outcomes] == [1, 2]


def test_memory_cues_stop_at_the_profile_limit():
    profile = replace(UNVERIFIED, memory_cue_limit=2)
    requests = (CueRequest("Intro", 1.0, False), CueRequest("Outro", 2.0, False))
    placement = place_cues(EXISTING, requests, profile)
    assert [outcome.status for outcome in placement.outcomes] == ["placed", "over_memory_limit"]


def test_memory_cue_colour_is_dropped_when_the_profile_says_it_does_not_import():
    profile = replace(UNVERIFIED, memory_cue_colours=False)
    requests = (CueRequest("Intro", 1.0, False, colour=(0, 255, 0)), hot("Drop"))
    memory, hot_mark = place_cues((), requests, profile).marks
    assert memory.colour is None
    assert hot_mark.colour == (255, 0, 0)


def test_times_are_rounded_to_milliseconds_and_loops_keep_their_end():
    loop = CueRequest("Loop", 1.23456, False, kind="loop", end_seconds=3.45678)
    (mark,) = place_cues((), (loop,), UNVERIFIED).marks
    assert (mark.kind, mark.start_seconds, mark.end_seconds) == ("loop", 1.235, 3.457)


def test_repeating_an_export_gives_the_same_marks():
    first = place_cues(EXISTING, (hot("Drop", 2),), UNVERIFIED)
    assert place_cues(first.marks, (hot("Drop", 2),), UNVERIFIED).marks == first.marks


def test_loop_end_within_a_millisecond_of_start_is_rejected():
    with pytest.raises(ValueError, match="end_seconds"):
        CueRequest("Loop", 1.2, False, kind="loop", end_seconds=1.2004)


def test_a_loop_ending_a_millisecond_after_its_start_places_fine():
    loop = CueRequest("Loop", 1.2, False, kind="loop", end_seconds=1.201)
    (mark,) = place_cues((), (loop,), UNVERIFIED).marks
    assert (mark.start_seconds, mark.end_seconds) == (1.2, 1.201)


def test_label_whitespace_is_stripped():
    assert CueRequest(" Drop ", 1.0, True).label == "Drop"


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"label": " "}, "label"),
        ({"label": "SV Drop"}, "SV prefix"),
        ({"hot": "yes"}, "hot"),
        ({"kind": "fade_in"}, "kind"),
        ({"kind": "loop"}, "end_seconds"),
        ({"end_seconds": 5.0}, "only loops"),
        ({"hot": False, "preferred_slot": 1}, "preferred_slot"),
        ({"preferred_slot": 8}, "preferred_slot"),
        ({"start_seconds": -1.0}, "start_seconds"),
        ({"colour": (1, 2)}, "colour"),
    ],
)
def test_cue_request_validation(changes, message):
    values = {"label": "Drop", "start_seconds": 1.0, "hot": True, **changes}
    with pytest.raises(ValueError, match=message):
        CueRequest(**values)


def test_cue_request_from_dict():
    data = {
        "label": "Drop",
        "start_seconds": 60,
        "hot": True,
        "preferred_slot": 0,
        "colour": [255, 0, 0],
    }
    assert CueRequest.from_dict(data) == CueRequest(
        "Drop", 60.0, True, preferred_slot=0, colour=(255, 0, 0)
    )
    with pytest.raises(ValueError, match="unknown fields: Colour"):
        CueRequest.from_dict(
            {"label": "Drop", "start_seconds": 60, "hot": True, "Colour": [1, 2, 3]}
        )
    with pytest.raises(ValueError, match="missing fields: hot"):
        CueRequest.from_dict({"label": "Drop", "start_seconds": 60})


def test_unknown_versions_get_the_unverified_profile(monkeypatch):
    assert profile_for("7.2.19") is UNVERIFIED
    assert not UNVERIFIED.verified
    measured = CapabilityProfile(("7.2.19",), 8, 10, True, "replace", True)
    monkeypatch.setattr(profile_module, "PROFILES", (measured,))
    assert profile_for("7.2.19") is measured
    assert measured.verified
    assert profile_for(None) is UNVERIFIED
