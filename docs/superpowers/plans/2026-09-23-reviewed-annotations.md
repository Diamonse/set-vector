# Reviewed Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a DJ export an editable review template for an analyzed track, import validated cues and corrections as an immutable local revision, and assemble a reproducible evaluation collection without changing audio or baseline feature artifacts.

**Architecture:** `ArtifactStore.load_stored(feature_id)` supplies the existing asset and baseline bundle without reopening audio. New domain and storage modules validate, identify, and publish full annotation snapshots; an application service handles template, import, and inspect operations. A separate collection manifest pins exact feature and annotation revision IDs and checks development/held-out grouping. The CLI remains a thin adapter.

**Tech Stack:** Python 3.11 standard library, existing dataclass/domain validation, `canonical_json` and `strict_json_loads`, argparse, pytest, Ruff. No new runtime dependency.

**Spec:** [Implementation Plan, Step 4](../../implementation-plan.md#4-evaluation-collection-and-editable-annotations), [Architecture: core data contracts](../../architecture.md#core-data-contracts), [Playlist Engine Evaluation](../../research/playlist-engine-evaluation.md), and [Analysis Engine Extension](../../research/analysis-engine-extension.md).

This focused plan supersedes Task 2 of the [broader prerequisite plan](2026-09-22-playlist-analysis-prerequisites.md) for the first annotation milestone. The broader task's record-level supersession fields and pairwise/transition judgments are deferred. Full revision snapshots and explicit IDs are the first contract.

## Scope and boundaries

- First usable workflow: `setvector review template <feature-id>`, edit the JSON, `setvector review import <path>`, and `setvector review show <revision-id>`. The exact command spelling can follow the CLI's existing parser style, but the JSON output and exit behavior below are part of the contract.
- Review one asset and one baseline feature ID per immutable revision. Full snapshots make omission an intentional removal. A child revision names one parent; selecting a revision is always explicit. Two reviewers' revisions remain separate evidence.
- Support approved or uncertain entry/exit cue regions, reviewed tempo and downbeat anchors, local or whole-track major/minor key or an explicit unknown/other result, style tags and remix-family metadata, and a declared ordinal user energy rank. The rank is a person's judgment, not calibrated cross-track energy.
- A point at 0 or exact decoded EOF can be valid; a cue region uses half-open `[start, end)` with `start < end <= decoded_duration`. Absence means unreviewed, `unknown` means reviewed but unresolved, and removal means a record from a parent snapshot is absent in a child.
- Pair/sequence preference judgments, automatic annotation generation, a browser editor, catalog updates, playlist search, and merging conflicting reviewers belong to later features. This plan leaves `analysis/`, `ingestion/`, `domain/bundle.py`, `storage/artifacts.py`, and report rendering untouched while analysis fixes proceed.
- Audio remains outside Git. Commit synthetic JSON fixtures and tests only. The core workflow must run without network access or the original music file after analysis has produced a saved artifact.

## Contracts and files

| File | Responsibility |
|---|---|
| New `src/setvector/domain/source_timing.py` | Derive the analyzed source duration from stored bundle diagnostics and the effective sample rate. |
| New `src/setvector/domain/annotations.py` | Typed record payloads, strict validation, normalized full snapshot, deterministic revision ID, `to_dict`/`from_dict`. |
| New `src/setvector/storage/annotations.py` | Strict JSON read, independent atomic publication, identity/parent verification, corruption handling. |
| New `src/setvector/application/annotations.py` | Load source context, make editable template, import a reviewed revision, inspect explicit revision. |
| New `src/setvector/domain/collection.py`, `storage/collections.py`, and `application/collections.py` | Collection manifest, split/reference validation, and immutable publication. |
| Small edit to `src/setvector/cli/__init__.py` | Register review and collection commands through the existing error and JSON conventions. |
| New `tests/test_source_timing.py`, `test_domain_annotations.py`, `test_storage_annotations.py`, `test_application_annotations.py`, `test_collection_manifest.py`, `test_cli_review.py`, `test_offline_review.py` | Contract, storage, CLI, and offline integration evidence. |
| New `examples/review-template.json` and `docs/reviewed-annotations.md` | Editable format and local review instructions. |

Use `src/setvector/storage/canonical.py::canonical_json` for IDs and `strict_json_loads` for untrusted JSON. Preserve the existing baseline-v1 reader and do not call the private `ArtifactStore._publish` method. `InputError` handles malformed user input or a missing requested revision; `ArtifactError` handles a published record that is incomplete, corrupt, or inconsistent. Successful CLI commands print one JSON object to stdout, with human diagnostics on stderr, as current commands do.

The revision body has exactly `schema_version`, `asset_id`, `feature_id`, `source_duration_seconds`, `parent_revision_id`, `reviewer_id`, `protocol_id`, and `records`. The application computes and verifies `source_duration_seconds` from the referenced stored feature artifact; it is not a user-authored estimate. The published file additionally has `revision_id`; compute that ID from the normalized body without its own ID. Every record has a stable `record_id`, `kind`, and kind-specific `value`. Normalize records by `record_id`, style tags as unique sorted strings, numeric times and BPM as finite floats, and text to a documented Unicode form before hashing. Reject duplicate record IDs and unknown fields. An import must not silently replace a conflicting or corrupt existing revision.

| `kind` | `value` fields for this milestone | Validation |
|---|---|---|
| `metadata` | optional artist/title, nonempty style-tag list, optional remix-family ID | One metadata record per snapshot; overlapping styles are allowed. |
| `tempo` | `status=confirmed` and positive BPM, or `status=unknown` | At most one global reviewed tempo; retain raw estimated BPM separately. |
| `downbeat_anchor` | one source-second point with `status=confirmed` or `uncertain` | Multiple anchors allowed; exact EOF valid; no assumed meter from one anchor. |
| `key` | `scope=track` or `scope=region` with `[start_seconds, end_seconds)`; `status=confirmed` with tonic and major/minor mode, or `status=unknown` or `other` | Permit one global judgment and multiple non-overlapping local judgments. Do not force a Camelot label for unknown or other tonality. |
| `cue` | `role=entry/exit`, source interval, `status=approved/uncertain/rejected`, optional beat anchor | Multiple cues per role allowed; approved cues must be usable source intervals. |
| `energy_rank` | `status=confirmed`, integer rank 1–5 and a nonempty scale ID; or `status=unknown` | One subjective rank per snapshot; do not compare ranks from different scales without a declared mapping. |

The exact version-1 `value` shapes are shown below, one independent JSON object per line:

```json
{"artist":"Artist","title":"Track","styles":["BollyHouse","House"],"recording_family_id":"song-1"}
{"status":"confirmed","bpm":124.0}
{"status":"unknown"}
{"status":"confirmed","seconds":32.0}
{"scope":"track","status":"confirmed","tonic":"A","mode":"minor"}
{"scope":"region","start_seconds":64.0,"end_seconds":96.0,"status":"other"}
{"scope":"track","status":"unknown"}
{"role":"entry","start_seconds":16.0,"end_seconds":32.0,"status":"approved","beat_anchor_seconds":16.0}
{"status":"confirmed","rank":3,"scale_id":"dj-energy-1-5-v1"}
```

The examples correspond in order to `metadata`, confirmed `tempo`, unknown `tempo` or `energy_rank`, `downbeat_anchor`, global confirmed `key`, local other `key`, global unknown `key`, `cue`, and confirmed `energy_rank`. Metadata requires `artist`, `title`, `styles`, and `recording_family_id`; artist, title, and family may be `null` for a standalone review, while styles must be nonempty. A published collection requires a nonnull family. A cue always includes `beat_anchor_seconds`, which may be `null` but, when present, must lie inside the cue interval. For a key with `status=unknown` or `other`, omit tonic and mode. Tonic is one of `C, C#, D, D#, E, F, F#, G, G#, A, A#, B`; mode is `major` or `minor`. A reviewed key region takes precedence over the global key within its interval, including an explicit local unknown/other decision. Outside reviewed local regions, use the global review if present. Reject overlapping local key regions. Every `value` rejects fields outside its exact kind/status shape. `record_id`, `reviewer_id`, `protocol_id`, and style strings are nonblank; times and BPM are finite numbers, while rank is a non-boolean integer.

The evaluation manifest has exactly `schema_version`, `protocol_id`, and `tracks`. Each track pins `asset_id`, `feature_id`, `revision_id`, `split` (`development` or `held_out`), nonempty style tags, and `recording_family_id`. Its ID is a hash of normalized content. Reusing an asset in both splits or placing a recording/remix/edit family across splits is invalid. Every referenced revision and feature must resolve when the manifest is published. The revision's `(asset_id, feature_id)` pair must match the track's pair, and its reviewed metadata styles and family must match the manifest fields. Require that metadata before publication. The manifest stores no source audio paths.

## Task 1: Source timing from saved artifacts

**Files:** Create `src/setvector/domain/source_timing.py` and `tests/test_source_timing.py`.

**Interface:** `decoded_duration_seconds(asset: AudioAsset, bundle: FeatureBundle) -> float`. Require matching asset IDs. With `n = analyzed_frames`, `f = frame_length`, `h = hop_length`, `tail = omitted_tail_samples`, and effective rate `r`, decoded samples equal `((n - 1) * h + f + tail)` for `n > 0`, otherwise `tail`; duration is samples/r. This matches the current report's duration rule while keeping annotation bounds independent of the private visualization helper. Confirm the rule again after Claude Code's analysis fixes before implementation begins.

- [ ] Add a failing test where `asset.duration_seconds` overstates the decoded length, plus zero frames, one frame, omitted tail, wrong asset ID, and different configured/native rates.

```python
assert decoded_duration_seconds(asset, bundle) == pytest.approx(expected_samples / rate)
assert decoded_duration_seconds(asset, bundle) != asset.duration_seconds
```

- [ ] Run `python -m pytest tests/test_source_timing.py -q`; confirm the new function is absent.
- [ ] Implement the pure helper without importing `visualization` or modifying current analysis/report code. Run the focused test and compare the result to the existing report-model duration fixture.
- [ ] Commit as `feat(domain): derive analyzed source duration`.

## Task 2: Strict annotation snapshot contract

**Files:** Create `src/setvector/domain/annotations.py`, `tests/test_domain_annotations.py`, and a small `examples/review-template.json` using synthetic lowercase SHA-256 IDs.

**Interfaces:** `AnnotationRecord.from_dict/to_dict`, `AnnotationRevision.from_dict/to_dict`, and `compute_revision_id(body) -> str`. Use frozen slotted dataclasses. A child snapshot keeps an unchanged record ID for a correction, replaces that record's value, and omits records intentionally removed from its parent.

- [ ] Write failing tests for every kind and status; valid point at zero/EOF; invalid negative, bool, NaN, reversed, zero-length, and beyond-EOF times; duplicate IDs; unknown fields; and `unknown` distinct from an absent record. Pass Task 1's decoded duration into validation.

```python
revision = AnnotationRevision.from_dict(body)
assert revision.to_dict()["records"] == sorted_records
assert compute_revision_id(revision.body_dict()) == revision.revision_id
```

- [ ] Run `python -m pytest tests/test_domain_annotations.py -q`; confirm failure before adding the contract.
- [ ] Implement kind-specific validators and canonical ordering. Normalize `1` and `1.0` source seconds to the same representation, preserve reviewer/protocol identity, and reject overlapping confirmed local key intervals unless the schema explicitly allows an alternative hypothesis.
- [ ] Run the focused tests, `python -m ruff check src/setvector/domain tests/test_domain_annotations.py`, and commit as `feat(annotations): define reviewed snapshots`.

## Task 3: Immutable revision storage and parent checks

**Files:** Create `src/setvector/storage/annotations.py` and `tests/test_storage_annotations.py`.

**Interface:** `AnnotationStore(workspace).publish(revision) -> Path` writes `annotations/<revision-id>/revision.json`; `load(revision_id) -> AnnotationRevision` verifies the stored body hash. A child parent must already exist and reference the same asset and feature ID. The store never changes baseline `asset.json`, `manifest.json`, or `arrays.npz`.

- [ ] Add failing tests for publish/load, missing parent, cross-asset or cross-feature parent, changed cue/reviewer/parent yielding a new ID, idempotent same-content publication, conflict/corruption at an existing ID, interrupted write, and two concurrent identical writers.

```python
saved = store.publish(revision)
assert saved.name == "revision.json"
assert store.load(revision.revision_id) == revision
assert feature_manifest.read_bytes() == original_feature_bytes
```

- [ ] Run `python -m pytest tests/test_storage_annotations.py -q`; confirm failure.
- [ ] Write a temporary sibling directory, fsync the JSON, read it back with `strict_json_loads`, then publish by rename. Validate the parent and any existing target before accepting it; leave incomplete/corrupt published directories as errors. Load without reading source audio.
- [ ] Re-run focused tests and `tests/test_storage_artifacts.py`; commit as `feat(storage): publish annotation revisions`.

## Task 4: Template, import, and inspect application workflow

**Files:** Create `src/setvector/application/annotations.py`, `tests/test_application_annotations.py`, and `docs/reviewed-annotations.md`.

**Interfaces:** `make_review_template(feature_id, artifact_store) -> dict`, `import_review(path, artifact_store, annotation_store) -> AnnotationRevision`, and `inspect_review(revision_id, annotation_store) -> dict`. Template and import call the existing `ArtifactStore.load_stored(feature_id)`, bind asset/feature IDs, and validate against Task 1's decoded duration. An imported child must pass Task 3's parent checks.

- [ ] Write failing tests that export a template with decoded duration, edit/add an approved cue and key, import it, inspect by explicit ID, then import a corrected child. Include a missing original music file, altered `source_duration_seconds`, mismatched feature ID, corrupt baseline artifact, and an attempted retagged-asset inheritance.

```python
template = make_review_template(bundle.feature_id, artifact_store)
assert template["asset_id"] == bundle.asset_id
assert template["source_duration_seconds"] == pytest.approx(decoded_duration)
```

- [ ] Run `python -m pytest tests/test_application_annotations.py -q`; confirm failure.
- [ ] Implement the application service and document one exact JSON round trip. Import recomputes `source_duration_seconds` from the pinned saved artifact and rejects a changed value before publishing. A retagged/reencoded asset requires an explicit new review rather than automatic inheritance.
- [ ] Re-run focused tests and commit as `feat(application): support local track reviews`.

## Task 5: Reproducible collection manifest

**Files:** Create `src/setvector/domain/collection.py`, `src/setvector/storage/collections.py`, `src/setvector/application/collections.py`, and `tests/test_collection_manifest.py`; add one synthetic manifest example under `examples/`.

**Interfaces:** `CollectionManifest.from_dict/to_dict`, `compute_collection_id(body) -> str`, `validate_collection(manifest, artifact_store, annotation_store) -> CollectionValidation`, `CollectionStore.publish(manifest) -> Path`, and `CollectionStore.load(collection_id) -> CollectionManifest`. The application exposes `publish_collection(path, artifact_store, annotation_store, collection_store) -> CollectionManifest`; it validates references and splits before storage publication. A frozen collection pins every referenced revision and feature ID; its split assignment is explicit rather than generated by the validator.

- [ ] Write failing tests for multiple style tags, stable ID despite input order, a missing asset/feature/revision, a revision for the wrong asset, a revision for a different feature of the same asset, metadata style/family mismatch, the same asset in both splits, and a remix family crossing development and held-out splits. Include publish/load, missing/corrupt published collection, and idempotent concurrent publication.

```python
validated = validate_collection(manifest, artifact_store, annotation_store)
assert validated.collection_id == compute_collection_id(manifest.body_dict())
assert validated.development_assets.isdisjoint(validated.held_out_assets)
```

- [ ] Run `python -m pytest tests/test_collection_manifest.py -q`; confirm failure.
- [ ] Implement strict schema, reference checks, canonical ordering, and atomic publication in a separate `collections/<collection-id>/manifest.json` area. The store verifies its ID on load and never replaces corruption. Document how a curator assigns related edits to one `recording_family_id` and keeps commercial audio outside Git.
- [ ] Re-run focused tests and commit as `feat(evaluation): pin review collection splits`.

## Task 6: Thin CLI and offline integration

**Files:** Modify only the parser/handlers in `src/setvector/cli/__init__.py`; create `tests/test_cli_review.py` and `tests/test_offline_review.py`; update `docs/development.md` with the new commands.

**Interface:** `review template` writes an editable JSON file without overwriting an existing path unless explicitly requested; `review import` and `review show` print one JSON result. `collection validate <path>` reports a proposed collection ID and split counts without saving; `collection import <path>` publishes it and returns its ID/path; `collection show <collection-id>` inspects the pinned manifest. Follow the existing `_call` exception and exit-code convention.

- [ ] Write CLI tests for a template → edit → import → show round trip, Unicode and spaced paths, duplicate keys, malformed fields, missing or corrupt revisions, refusal to overwrite a template, and stdout/stderr separation.
- [ ] Extend the existing blocked-socket integration pattern to template/import/show and collection validation after deleting the original audio file. Verify raw feature and asset artifact bytes remain unchanged.

```text
python -m setvector review template <feature-id> --workspace .setvector --output review.json
python -m setvector review import review.json --workspace .setvector
python -m setvector review show <revision-id> --workspace .setvector
python -m setvector collection validate collection.json --workspace .setvector
python -m setvector collection import collection.json --workspace .setvector
python -m setvector collection show <collection-id> --workspace .setvector
```

- [ ] Run focused tests, then `python -m pytest -q`, `python -m ruff check src tests`, and `python -m ruff format --check src tests`. Run the installed-package commands with network blocked and no original audio present.
- [ ] Record the observed CLI and offline results in the documentation; commit executable changes as `feat(cli): add reviewed annotation workflow` and documentation as `docs: describe local review workflow`.

## Completion criteria

A DJ can create, correct, and retrieve an explicit review revision for an analyzed track using only saved local artifacts. Invalid time bounds, ambiguous or corrupt revisions, and leaked evaluation splits are rejected with actionable errors. Baseline feature IDs and files remain unchanged, and the full CLI workflow works offline. The next feature can consume an explicit annotation revision ID; it must not guess which review is authoritative.
