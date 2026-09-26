# Rekordbox compatibility

SetVector writes Rekordbox XML only for behaviour measured with `scripts/rekordbox_probe.py`
on a named Rekordbox version. Each qualified version has a profile in
`src/setvector/rekordbox/profile.py`.

SetVector requires a Rekordbox version qualified with `scripts/rekordbox_probe.py` before it
writes a grid or cues into a track already in the collection. New tracks are not gated.
Until a version is qualified, `--unverified-rekordbox` is required for that update, and
SetVector assumes 8 hot cue slots and 10 memory cues per track.

## What the probe measures

`scripts/rekordbox_probe.py generate <folder>` writes three synthetic drum tracks (kick,
snare, hats, bass and crash, about 90 seconds each): a 120 BPM constant grid over 44 bars,
a grid changing from 120 to 128 BPM at bar 23, and a 124 BPM grid starting after 2.3 seconds
of silence. It analyzes them, writes hot cues A–F and twelve named memory cues plus a loop
on the first track, hot cues A–H on the second, and one hot cue plus two memory cues on the
third, and writes `stage1.xml` and a `CHECKLIST.md` describing the manual steps. After the
user imports `stage1.xml`, adds one hot cue and one memory cue by hand, and exports the
collection, `stage2 <folder> --library <export>` builds `stage2.xml`, which moves one
SetVector hot cue, removes one, adds one, and renames one memory cue, to be imported twice.
`check <folder> --export1 <export> [--export2 <export>]` compares each Rekordbox export
against the corresponding stage file and reports, per track, marker and mark, whether
Rekordbox kept, rounded, changed, dropped, or duplicated it, and which marks it added.
`generate` writes `probe.json`; `check` writes `probe-results.json`.

The findings answer: whether re-importing a track already in the collection replaces,
merges, or ignores it; whether hot cue slots D–H and memory cue colours survive import;
whether an imported grid survives Rekordbox's own analysis; and how closely Rekordbox
preserves marker and mark timing.

## Known open points

- Whether Rekordbox keeps a single-beat bridging tempo marker. SetVector writes one when a
  segment boundary has a long gap after it, so that its own grid does not predict a
  spurious extra beat inside the gap. The probe's tempo change at bar 23 has no such gap,
  so the probe does not exercise this marker.
- Whether Rekordbox accepts a `TrackID` up to 2³¹−1; SetVector derives new tracks' IDs from
  the first eight hex digits of their asset ID, masked to that range.
- The `SV ` name prefix is SetVector's only ownership marker on a cue. A user cue whose name
  already starts with `SV ` would be treated as SetVector's own on the next export and
  replaced.
- XML attribute-value normalization turns a literal line break inside an attribute value
  into a space. A multi-line `Comments` field in the user's export is already single-line,
  with spaces where the line breaks were, once SetVector reads it, and stays that way in
  what SetVector writes back.

To qualify a version, run `python scripts/rekordbox_probe.py generate <folder>` and follow
the generated `CHECKLIST.md`.
