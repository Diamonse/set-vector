"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, FilterX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/app/status-badge";
import { EnergyMeter } from "@/components/music/energy-meter";
import { KeyChip } from "@/components/music/key-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usableKey } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";
import type { Track } from "@/lib/domain/types";
import {
  activeFilterCount,
  CAMELOT_CODES,
  CUE_STATE_LABEL,
  DEFAULT_DIR,
  EMPTY_FILTERS,
  filterTracks,
  sortTracks,
  type CueState,
  type SortDir,
  type SortKey,
  type TrackFilters,
} from "@/lib/library/filters";
import { cn } from "@/lib/utils";

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

const FIELD = "min-h-9 px-2 py-1 text-[14px]";
// Header cells use the mono eyebrow style; the filter row resets it so inputs read normally.
const FILTER_CELL = "h-auto py-2 align-top font-sans text-[14px] font-normal tracking-normal normal-case";

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("inline-flex items-center gap-1 uppercase transition-colors hover:text-ink", active ? "text-ink" : "text-muted", className?.includes("text-right") && "flex-row-reverse")}
      >
        {label}
        <Icon className={cn("size-3.5", active ? "text-action" : "opacity-60")} aria-hidden />
        <span className="sr-only">{active ? `, sorted ${sort.dir === "asc" ? "ascending" : "descending"}` : ", sort"}</span>
      </button>
    </TableHead>
  );
}

function Range({
  label,
  min,
  max,
  onMin,
  onMax,
  placeholder,
  inputMode = "decimal",
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  placeholder: [string, string];
  inputMode?: "decimal" | "text";
}) {
  return (
    <div className="flex min-w-[7.5rem] items-center gap-1">
      <Input aria-label={`${label} from`} placeholder={placeholder[0]} inputMode={inputMode} value={min} onChange={(e) => onMin(e.target.value)} className={cn(FIELD, "w-16")} />
      <span className="text-caption text-muted" aria-hidden>
        to
      </span>
      <Input aria-label={`${label} to`} placeholder={placeholder[1]} inputMode={inputMode} value={max} onChange={(e) => onMax(e.target.value)} className={cn(FIELD, "w-16")} />
    </div>
  );
}

export function TrackTable({ tracks }: { tracks: Track[] }) {
  const [filters, setFilters] = useState<TrackFilters>(EMPTY_FILTERS);
  const [review, setReview] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "artist", dir: "asc" });
  const set = (patch: Partial<TrackFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const styles = useMemo(() => [...new Set(tracks.flatMap((t) => t.styleTags))].sort((a, b) => a.localeCompare(b)), [tracks]);
  const rows = useMemo(() => {
    const filtered = filterTracks(tracks, filters).filter((t) => (review === "needs" ? needsReview(t) : review === "complete" ? !needsReview(t) : true));
    return sortTracks(filtered, sort.key, sort.dir);
  }, [tracks, filters, review, sort]);
  const active = activeFilterCount(filters) + (review !== "all" ? 1 : 0);
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: DEFAULT_DIR[key] }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="track-review">Review state</Label>
            <NativeSelect id="track-review" value={review} onChange={(e) => setReview(e.target.value)} className="min-w-48">
              <option value="all">All tracks</option>
              <option value="needs">Needs review</option>
              <option value="complete">Reviewed evidence</option>
            </NativeSelect>
          </div>
          <p className="pb-2.5 text-caption text-muted" aria-live="polite">
            {rows.length} of {tracks.length} tracks{active ? ` · ${active} filter${active === 1 ? "" : "s"} on` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={active === 0}
          onClick={() => {
            setFilters(EMPTY_FILTERS);
            setReview("all");
          }}
        >
          <FilterX aria-hidden /> Clear filters
        </Button>
      </div>

      <div className="panel overflow-hidden">
        <Table>
          <TableCaption className="px-3 pb-3 text-left">
            Click a column header to sort; click again to reverse. Energy is your relative 1 to 10 rating or the automatic estimate, not a calibrated
            measurement.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <SortHeader label="Track" column="title" sort={sort} onSort={onSort} />
              <SortHeader label="Styles" column="style" sort={sort} onSort={onSort} />
              <SortHeader label="BPM" column="bpm" sort={sort} onSort={onSort} className="text-right" />
              <SortHeader label="Key" column="key" sort={sort} onSort={onSort} />
              <SortHeader label="Energy" column="energy" sort={sort} onSort={onSort} className="text-right" />
              <SortHeader label="Length" column="length" sort={sort} onSort={onSort} className="text-right" />
              <SortHeader label="Cues" column="cues" sort={sort} onSort={onSort} />
            </TableRow>
            <TableRow className="bg-surface-subtle/50 hover:bg-surface-subtle/50">
              <TableHead className={FILTER_CELL}>
                <div className="flex flex-col gap-1.5">
                  <Input type="search" aria-label="Filter by title, artist, or version" placeholder="Title or artist" value={filters.text} onChange={(e) => set({ text: e.target.value })} className={cn(FIELD, "min-w-40")} />
                  <button
                    type="button"
                    onClick={() => onSort("artist")}
                    className={cn("self-start text-[12px] font-normal tracking-normal normal-case hover:text-ink", sort.key === "artist" ? "text-action" : "text-muted")}
                  >
                    Sort by artist{sort.key === "artist" ? (sort.dir === "asc" ? " (A to Z)" : " (Z to A)") : ""}
                  </button>
                </div>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <NativeSelect aria-label="Filter by style" value={filters.style} onChange={(e) => set({ style: e.target.value })} className={cn(FIELD, "min-w-32 pr-8")}>
                  <option value="">All styles</option>
                  {styles.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <div className="flex flex-col items-end gap-1.5">
                  <Range label="BPM" min={filters.bpmMin} max={filters.bpmMax} onMin={(v) => set({ bpmMin: v })} onMax={(v) => set({ bpmMax: v })} placeholder={["min", "max"]} />
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-normal tracking-normal text-muted normal-case">
                    <Checkbox checked={filters.bpmHalfDouble} onCheckedChange={(v) => set({ bpmHalfDouble: v === true })} className="size-4" />
                    Half or double
                  </label>
                </div>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <div className="flex flex-col gap-1.5">
                  <NativeSelect aria-label="Filter by key" value={filters.key} onChange={(e) => set({ key: e.target.value })} className={cn(FIELD, "min-w-28 pr-8")}>
                    <option value="">Any key</option>
                    {CAMELOT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="none">No usable key</option>
                  </NativeSelect>
                  <label className="inline-flex items-center gap-1.5 text-[12px] font-normal tracking-normal text-muted normal-case">
                    <Checkbox
                      checked={filters.keyCompatible}
                      disabled={!filters.key || filters.key === "none"}
                      onCheckedChange={(v) => set({ keyCompatible: v === true })}
                      className="size-4"
                    />
                    Compatible keys
                  </label>
                </div>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <div className="flex justify-end">
                  <Range label="Energy" min={filters.energyMin} max={filters.energyMax} onMin={(v) => set({ energyMin: v })} onMax={(v) => set({ energyMax: v })} placeholder={["1", "10"]} />
                </div>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <div className="flex justify-end">
                  <Range
                    label="Length"
                    min={filters.lengthMin}
                    max={filters.lengthMax}
                    onMin={(v) => set({ lengthMin: v })}
                    onMax={(v) => set({ lengthMax: v })}
                    placeholder={["0:00", "9:59"]}
                    inputMode="text"
                  />
                </div>
              </TableHead>
              <TableHead className={FILTER_CELL}>
                <NativeSelect aria-label="Filter by cue regions" value={filters.cues} onChange={(e) => set({ cues: e.target.value as "" | CueState })} className={cn(FIELD, "min-w-36 pr-8")}>
                  <option value="">Any cues</option>
                  {(Object.keys(CUE_STATE_LABEL) as CueState[]).map((c) => (
                    <option key={c} value={c}>
                      {CUE_STATE_LABEL[c]}
                    </option>
                  ))}
                </NativeSelect>
              </TableHead>
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
                    <Link href={`/library/${t.id}`} className="font-semibold text-ink no-underline hover:text-action">
                      {t.title}
                    </Link>
                    {t.versionLabel ? <span className="text-muted"> ({t.versionLabel})</span> : null}
                    <div className="text-caption text-muted">{t.artist || "Unknown artist"}</div>
                  </TableCell>
                  <TableCell>
                    {t.styleTags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {t.styleTags.slice(0, 3).map((s) => (
                          <span key={s} className="rounded-full border border-divider bg-surface-subtle px-2 py-0.5 text-[12px] leading-4 whitespace-nowrap text-body">
                            {s}
                          </span>
                        ))}
                        {t.styleTags.length > 3 ? <span className="text-caption text-muted">+{t.styleTags.length - 3}</span> : null}
                      </span>
                    ) : (
                      <span className="text-caption text-muted">None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-data">
                    {t.bpm === null ? <span className="font-sans text-muted">Unavailable</span> : formatBpm(t.bpm)}
                    {t.bpmSource === "estimate" ? <div className="font-sans text-caption text-muted">Estimated</div> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {key ? (
                      <KeyChip musicalKey={key} estimated={t.keyStatus === "estimated"} />
                    ) : (
                      <span className="text-muted">{t.keyStatus === "not_meaningful" ? "Not meaningful" : t.keyStatus === "uncertain" ? "Uncertain" : "Unavailable"}</span>
                    )}
                    {key && t.keyStatus === "estimated" ? <div className="text-caption text-muted">Estimated</div> : null}
                  </TableCell>
                  <TableCell className="text-right text-data">
                    {t.energy === null ? <span className="font-sans text-muted">Unavailable</span> : <EnergyMeter value={t.energy} />}
                    {t.energy !== null && t.energySource === "estimate" ? <div className="font-sans text-caption text-muted">Estimated</div> : null}
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
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-body">No tracks match these filters.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setReview("all");
              }}
            >
              <FilterX aria-hidden /> Clear filters
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
