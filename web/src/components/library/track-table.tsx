"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/app/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCamelot, toCamelot, usableKey } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";
import type { Track } from "@/lib/domain/types";

type SortKey = "artist" | "title" | "bpm" | "energy" | "updated";

function needsReview(t: Track): boolean {
  return (
    t.bpm === null ||
    t.bpmSource === "estimate" ||
    usableKey(t.keyTonic, t.keyMode, t.keyStatus) === null ||
    t.keyStatus === "estimated" ||
    t.energy === null ||
    !t.cues.some((c) => c.kind === "entry" && c.reviewStatus === "approved") ||
    !t.cues.some((c) => c.kind === "exit" && c.reviewStatus === "approved")
  );
}

export function TrackTable({ tracks }: { tracks: Track[] }) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState("");
  const [review, setReview] = useState("all");
  const [sort, setSort] = useState<SortKey>("artist");

  const styles = useMemo(() => [...new Set(tracks.flatMap((t) => t.styleTags))].sort((a, b) => a.localeCompare(b)), [tracks]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tracks.filter((t) => {
      if (q && !`${t.title} ${t.artist} ${t.versionLabel}`.toLowerCase().includes(q)) return false;
      if (style && !t.styleTags.includes(style)) return false;
      if (review === "needs" && !needsReview(t)) return false;
      if (review === "complete" && needsReview(t)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Track, b: Track) => number> = {
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
      bpm: (a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity),
      energy: (a, b) => (b.energy ?? -Infinity) - (a.energy ?? -Infinity),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return filtered.sort(cmp[sort]);
  }, [tracks, query, style, review, sort]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="track-search">Search</Label>
          <Input id="track-search" type="search" placeholder="Title or artist" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="track-style">Style</Label>
          <NativeSelect id="track-style" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">All styles</option>
            {styles.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="track-review">Review state</Label>
          <NativeSelect id="track-review" value={review} onChange={(e) => setReview(e.target.value)}>
            <option value="all">All tracks</option>
            <option value="needs">Needs review</option>
            <option value="complete">Reviewed evidence</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="track-sort">Sort by</Label>
          <NativeSelect id="track-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="artist">Artist</option>
            <option value="title">Title</option>
            <option value="bpm">BPM (low to high)</option>
            <option value="energy">Energy (high to low)</option>
            <option value="updated">Recently updated</option>
          </NativeSelect>
        </div>
      </div>

      <div className="rounded-[12px] border border-divider bg-surface">
        <Table>
          <TableCaption className="px-3 pb-3 text-left" aria-live="polite">
            Showing {rows.length} of {tracks.length} tracks. Energy is your relative 1 to 10 annotation, not a calibrated measurement.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Track</TableHead>
              <TableHead>Styles</TableHead>
              <TableHead className="text-right">BPM</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Energy (1 to 10)</TableHead>
              <TableHead className="text-right">Length</TableHead>
              <TableHead>Cues</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => {
              const key = usableKey(t.keyTonic, t.keyMode, t.keyStatus);
              const entries = t.cues.filter((c) => c.kind === "entry" && c.reviewStatus !== "rejected");
              const exits = t.cues.filter((c) => c.kind === "exit" && c.reviewStatus !== "rejected");
              const unreviewed = t.cues.some((c) => c.reviewStatus === "pending");
              return (
                <TableRow key={t.id}>
                  <TableCell className="min-w-[220px]">
                    <Link href={`/library/${t.id}`} className="font-semibold">
                      {t.title}
                    </Link>
                    {t.versionLabel ? <span className="text-muted"> ({t.versionLabel})</span> : null}
                    <div className="text-caption text-muted">{t.artist || "Unknown artist"}</div>
                  </TableCell>
                  <TableCell className="text-caption">{t.styleTags.join(", ") || <span className="text-muted">None</span>}</TableCell>
                  <TableCell className="text-right text-data">
                    {t.bpm === null ? <span className="font-sans text-muted">Unavailable</span> : formatBpm(t.bpm)}
                    {t.bpmSource === "estimate" ? <div className="font-sans text-caption text-muted">Estimated</div> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {key ? (
                      <span className="text-data">{formatCamelot(toCamelot(key))}</span>
                    ) : (
                      <span className="text-muted">{t.keyStatus === "not_meaningful" ? "Not meaningful" : t.keyStatus === "uncertain" ? "Uncertain" : "Unavailable"}</span>
                    )}
                    {key && t.keyStatus === "estimated" ? <div className="text-caption text-muted">Estimated</div> : null}
                  </TableCell>
                  <TableCell className="text-right text-data">
                    {t.energy === null ? <span className="font-sans text-muted">Unavailable</span> : t.energy}
                  </TableCell>
                  <TableCell className="text-right text-data">{formatTime(t.durationSeconds)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entries.length === 0 && exits.length === 0 ? (
                      <StatusBadge kind="fallback" />
                    ) : (
                      <span className="text-caption">
                        {entries.length} in · {exits.length} out
                        {unreviewed ? <span className="block text-warning">Some pending</span> : null}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
