"use client";

import { Disc3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { importRekordboxBatch, type RekordboxOutcome } from "@/app/actions/rekordbox";
import { FormField } from "@/components/app/form-field";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeTrackKey } from "@/lib/domain/camelot";
import { formatTime } from "@/lib/domain/format";
import { candidateFor, type RekordboxCandidate } from "@/lib/rekordbox/map";
import { parseLibrary, RekordboxError } from "@/lib/rekordbox/read";
import { REKORDBOX_BATCH, type RekordboxImportTrack } from "@/lib/rekordbox/schema";

const MAX_FILE_BYTES = 200_000_000;
const VISIBLE_ROWS = 200;

interface Loaded {
  fileName: string;
  product: { name: string | null; version: string | null };
  candidates: RekordboxCandidate[];
}

function payloadFor(c: RekordboxCandidate): RekordboxImportTrack {
  return {
    rekordboxTrackId: c.rekordboxTrackId,
    location: c.location,
    title: c.title,
    artist: c.artist,
    versionLabel: c.versionLabel,
    styleTags: c.styleTags,
    durationSeconds: c.durationSeconds!,
    bpm: c.bpm,
    key: c.key,
    tempo: c.tempo,
    marks: c.marks,
  };
}

/** Rekordbox XML import: the file is parsed here, and only selected tracks are sent in batches. */
export function RekordboxImport() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<RekordboxOutcome[] | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const importable = useMemo(() => loaded?.candidates.filter((c) => !c.blocked) ?? [], [loaded]);
  const visible = useMemo(() => {
    if (!loaded) return [];
    const q = filter.trim().toLowerCase();
    const rows = q
      ? loaded.candidates.filter((c) => `${c.title} ${c.artist} ${c.fileName ?? ""} ${c.styleTags.join(" ")}`.toLowerCase().includes(q))
      : loaded.candidates;
    return rows;
  }, [loaded, filter]);
  const counts = useMemo(() => {
    const cs = loaded?.candidates ?? [];
    return {
      total: cs.length,
      blocked: cs.filter((c) => c.blocked).length,
      caution: cs.filter((c) => !c.blocked && c.caution).length,
      grids: cs.filter((c) => !c.blocked && c.tempo.length > 0).length,
    };
  }, [loaded]);
  const busy = progress !== null && progress.done < progress.total;

  async function readFile(file: File | undefined) {
    setLoaded(null);
    setError(null);
    setOutcomes(null);
    setBatchError(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("The file is larger than 200 MB.");
      return;
    }
    setReading(true);
    try {
      const library = parseLibrary(new Uint8Array(await file.arrayBuffer()), file.name);
      const candidates = library.tracks.map(candidateFor);
      setLoaded({ fileName: file.name, product: { name: library.productName, version: library.productVersion }, candidates });
      setSelected(new Set(candidates.filter((c) => !c.blocked && !c.caution).map((c) => c.rekordboxTrackId)));
    } catch (e) {
      setError(e instanceof RekordboxError ? e.message : `The file could not be read: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  function toggle(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runImport() {
    if (!loaded) return;
    const chosen = importable.filter((c) => selected.has(c.rekordboxTrackId));
    if (!chosen.length) return;
    setOutcomes([]);
    setBatchError(null);
    setProgress({ done: 0, total: chosen.length });
    const all: RekordboxOutcome[] = [];
    for (let i = 0; i < chosen.length; i += REKORDBOX_BATCH) {
      const batch = chosen.slice(i, i + REKORDBOX_BATCH);
      try {
        const claimedTrackIds = all.flatMap((o) => (o.trackId && o.status !== "skipped" ? [o.trackId] : []));
        const result = await importRekordboxBatch({ product: loaded.product, tracks: batch.map(payloadFor), claimedTrackIds });
        if (result.message) {
          setBatchError(result.message);
          break;
        }
        all.push(...result.outcomes);
      } catch (e) {
        setBatchError(`A batch failed: ${(e as Error).message}`);
        break;
      }
      setOutcomes([...all]);
      setProgress({ done: Math.min(i + batch.length, chosen.length), total: chosen.length });
    }
    setProgress((p) => (p ? { ...p, total: p.done } : p));
  }

  const summary = useMemo(() => {
    const s = { created: 0, linked: 0, updated: 0, skipped: 0, cueRegions: 0 };
    outcomes?.forEach((o) => {
      s[o.status]++;
      s.cueRegions += o.cueRegions ?? 0;
    });
    return s;
  }, [outcomes]);
  const titleOf = useMemo(() => new Map(loaded?.candidates.map((c) => [c.rekordboxTrackId, c.title]) ?? []), [loaded]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Collection file</CardTitle>
          <CardDescription>A Rekordbox collection export (rekordbox.xml). Nothing is sent until you choose Import.</CardDescription>
        </CardHeader>
        <FormField id="rekordbox-file" label="File">
          <Input id="rekordbox-file" type="file" accept=".xml,application/xml,text/xml" disabled={busy} onChange={(e) => void readFile(e.target.files?.[0])} />
        </FormField>
        {reading ? (
          <p className="mt-3 flex items-center gap-2 text-caption text-muted">
            <Disc3 className="size-4 animate-spin" aria-hidden /> Reading the collection
          </p>
        ) : null}
        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}
      </Card>

      {loaded ? (
        <Card>
          <CardHeader>
            <CardTitle>Tracks</CardTitle>
            <CardDescription>
              {counts.total} in {loaded.fileName}
              {loaded.product.name ? ` from ${loaded.product.name} ${loaded.product.version ?? ""}`.trimEnd() : ""}. {counts.total - counts.blocked}{" "}
              importable, {counts.grids} with a beat grid. {counts.blocked ? `${counts.blocked} cannot be imported. ` : ""}
              {counts.caution ? `${counts.caution} short samples are left unselected.` : ""}
            </CardDescription>
          </CardHeader>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <FormField id="rekordbox-filter" label="Filter" className="min-w-[16rem] flex-1">
              <Input id="rekordbox-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Title, artist, file, or genre" />
            </FormField>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setSelected(new Set(importable.map((c) => c.rekordboxTrackId)))}>
              Select all importable
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Import</span>
                </TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead className="text-right">Length</TableHead>
                <TableHead className="text-right">BPM</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Beats</TableHead>
                <TableHead>Cue regions</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.slice(0, VISIBLE_ROWS).map((c) => (
                <TableRow key={c.rekordboxTrackId}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(c.rekordboxTrackId)}
                      disabled={!!c.blocked || busy}
                      onCheckedChange={(v) => toggle(c.rekordboxTrackId, v === true)}
                      aria-label={`Import ${c.title || c.fileName || c.rekordboxTrackId}`}
                    />
                  </TableCell>
                  <TableCell>
                    {c.title || <span className="text-muted">Untitled</span>}
                    {c.versionLabel ? <span className="text-muted"> ({c.versionLabel})</span> : null}
                  </TableCell>
                  <TableCell>{c.artist}</TableCell>
                  <TableCell className="text-right text-data">{c.durationSeconds === null ? "n/a" : formatTime(c.durationSeconds)}</TableCell>
                  <TableCell className="text-right text-data">{c.bpm ?? "n/a"}</TableCell>
                  <TableCell className="text-caption">{c.key ? describeTrackKey(c.key.tonic, c.key.mode, "estimated") : "n/a"}</TableCell>
                  <TableCell className="text-right text-data">{c.beatCount || "none"}</TableCell>
                  <TableCell className="text-caption whitespace-nowrap">
                    {c.blocked ? (
                      <span className="text-muted">n/a</span>
                    ) : (
                      <>
                        <span className="text-ink">
                          {c.cueRegions.entries} in · {c.cueRegions.exits} out
                        </span>
                        {c.cueRegions.fromGrid ? <span className="block text-muted">+{c.cueRegions.fromGrid} from grid</span> : null}
                        {c.cueRegions.ignored ? <span className="block text-muted">{c.cueRegions.ignored} mid-track cue(s) skipped</span> : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-caption">
                    {c.blocked ? <StatusBadge kind="unavailable" label={c.blocked} /> : c.caution ? <StatusBadge kind="review" label={c.caution} /> : null}
                    {c.notes.length ? <span className="block text-muted">{c.notes.join("; ")}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visible.length > VISIBLE_ROWS ? (
            <p className="mt-3 text-caption text-muted">
              Showing {VISIBLE_ROWS} of {visible.length} rows. Use the filter to find others; selection covers all rows.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button type="button" disabled={busy || selected.size === 0} onClick={() => void runImport()}>
              {busy ? <Disc3 className="animate-spin" aria-hidden /> : null}
              {busy ? `Importing ${progress!.done} of ${progress!.total}` : `Import ${selected.size} track(s)`}
            </Button>
            <span className="text-caption text-muted">Sent in batches of {REKORDBOX_BATCH}. Importing again updates the same links.</span>
          </div>
        </Card>
      ) : null}

      {batchError ? (
        <Alert tone="error">
          {batchError}
        </Alert>
      ) : null}

      {outcomes && outcomes.length > 0 ? (
        <Alert tone={summary.skipped ? "warning" : "success"}>
          <AlertTitle>
            {summary.created} added, {summary.linked} linked to existing tracks, {summary.updated} updated, {summary.skipped} skipped.{" "}
            {summary.cueRegions} cue region(s) created.
          </AlertTitle>
          {summary.skipped ? (
            <ul className="mt-2 list-disc pl-5 text-caption">
              {outcomes
                .filter((o) => o.status === "skipped")
                .slice(0, 30)
                .map((o) => (
                  <li key={o.rekordboxTrackId}>
                    {o.trackId ? <Link href={`/library/${o.trackId}`}>{titleOf.get(o.rekordboxTrackId)}</Link> : titleOf.get(o.rekordboxTrackId)}: {o.message}
                  </li>
                ))}
            </ul>
          ) : null}
          <p className="mt-2">
            <Link href="/library">Open the library</Link>
          </p>
        </Alert>
      ) : null}
    </div>
  );
}
