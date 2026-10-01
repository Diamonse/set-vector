"use client";

import { ArrowDown, ArrowUp, FilterX, SlidersHorizontal } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCamelot, toCamelot, usableKey } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";
import {
  activeFilterCount,
  CAMELOT_CODES,
  CUE_STATE_LABEL,
  DEFAULT_DIR,
  EMPTY_FILTERS,
  filterTracks,
  SORT_LABEL,
  sortTracks,
  type CueState,
  type FilterableTrack,
  type SortDir,
  type SortKey,
  type TrackFilters,
} from "@/lib/library/filters";
import { cn } from "@/lib/utils";

export interface PickerTrack extends FilterableTrack {
  keyStatus: "unknown" | "estimated" | "reviewed" | "uncertain" | "not_meaningful";
}

const FIELD = "min-h-9 px-2 py-1 text-[14px]";
const SORTS: SortKey[] = ["title", "artist", "bpm", "key", "energy", "length", "style", "cues"];

/**
 * Filterable, sortable checkbox list. When `name` is set, selected IDs are also
 * submitted as repeated hidden form fields.
 */
export function TrackPicker({
  tracks,
  selected,
  onChange,
  label,
  name,
  maxHeight = 420,
}: {
  tracks: PickerTrack[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label: string;
  name?: string;
  maxHeight?: number;
}) {
  const id = useId();
  const [filters, setFilters] = useState<TrackFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "title", dir: "asc" });
  const [showFilters, setShowFilters] = useState(false);
  const set = (patch: Partial<TrackFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const styles = useMemo(() => [...new Set(tracks.flatMap((t) => t.styleTags))].sort((a, b) => a.localeCompare(b)), [tracks]);
  const visible = useMemo(() => sortTracks(filterTracks(tracks, filters), sort.key, sort.dir), [tracks, filters, sort]);
  const active = activeFilterCount(filters);
  // Text search lives outside the panel; count only the panel's filters on its toggle.
  const panelActive = active - (filters.text.trim() ? 1 : 0);

  const toggle = (trackId: string, on: boolean) => {
    if (on) onChange([...selected, trackId]);
    else onChange(selected.filter((x) => x !== trackId));
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-ui text-ink">{label}</legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder="Search title or artist"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant={showFilters || panelActive ? "secondary" : "ghost"} size="sm" aria-expanded={showFilters} aria-controls={`${id}-filters`} onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal aria-hidden /> Filters{panelActive ? ` (${panelActive})` : ""}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange([...new Set([...selected, ...visible.map((t) => t.id)])])}
          >
            Select shown
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const shown = new Set(visible.map((t) => t.id));
              onChange(selected.filter((x) => !shown.has(x)));
            }}
          >
            Clear shown
          </Button>
        </div>
      </div>

      {showFilters ? (
        <div id={`${id}-filters`} className="grid gap-3 rounded-control border border-divider bg-surface-subtle/50 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <PickerField label="Style">
            <NativeSelect aria-label="Style" value={filters.style} onChange={(e) => set({ style: e.target.value })} className={cn(FIELD, "pr-8")}>
              <option value="">All styles</option>
              {styles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
          </PickerField>
          <PickerField label="BPM">
            <div className="flex items-center gap-1">
              <Input aria-label="BPM from" placeholder="min" inputMode="decimal" value={filters.bpmMin} onChange={(e) => set({ bpmMin: e.target.value })} className={FIELD} />
              <span className="text-caption text-muted">to</span>
              <Input aria-label="BPM to" placeholder="max" inputMode="decimal" value={filters.bpmMax} onChange={(e) => set({ bpmMax: e.target.value })} className={FIELD} />
            </div>
            <label className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted">
              <Checkbox checked={filters.bpmHalfDouble} onCheckedChange={(v) => set({ bpmHalfDouble: v === true })} className="size-4" />
              Half or double
            </label>
          </PickerField>
          <PickerField label="Key">
            <NativeSelect aria-label="Key" value={filters.key} onChange={(e) => set({ key: e.target.value })} className={cn(FIELD, "pr-8")}>
              <option value="">Any key</option>
              {CAMELOT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="none">No usable key</option>
            </NativeSelect>
            <label className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted">
              <Checkbox
                checked={filters.keyCompatible}
                disabled={!filters.key || filters.key === "none"}
                onCheckedChange={(v) => set({ keyCompatible: v === true })}
                className="size-4"
              />
              Compatible keys
            </label>
          </PickerField>
          <PickerField label="Energy">
            <div className="flex items-center gap-1">
              <Input aria-label="Energy from" placeholder="1" inputMode="decimal" value={filters.energyMin} onChange={(e) => set({ energyMin: e.target.value })} className={FIELD} />
              <span className="text-caption text-muted">to</span>
              <Input aria-label="Energy to" placeholder="10" inputMode="decimal" value={filters.energyMax} onChange={(e) => set({ energyMax: e.target.value })} className={FIELD} />
            </div>
          </PickerField>
          <PickerField label="Length">
            <div className="flex items-center gap-1">
              <Input aria-label="Length from" placeholder="0:00" value={filters.lengthMin} onChange={(e) => set({ lengthMin: e.target.value })} className={FIELD} />
              <span className="text-caption text-muted">to</span>
              <Input aria-label="Length to" placeholder="9:59" value={filters.lengthMax} onChange={(e) => set({ lengthMax: e.target.value })} className={FIELD} />
            </div>
          </PickerField>
          <PickerField label="Cue regions">
            <NativeSelect aria-label="Cue regions" value={filters.cues} onChange={(e) => set({ cues: e.target.value as "" | CueState })} className={cn(FIELD, "pr-8")}>
              <option value="">Any cues</option>
              {(Object.keys(CUE_STATE_LABEL) as CueState[]).map((c) => (
                <option key={c} value={c}>
                  {CUE_STATE_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
          </PickerField>
          <PickerField label="Sort by">
            <div className="flex items-center gap-1">
              <NativeSelect
                aria-label="Sort by"
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort({ key, dir: DEFAULT_DIR[key] });
                }}
                className={cn(FIELD, "pr-8")}
              >
                {SORTS.map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABEL[k]}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                aria-label={sort.dir === "asc" ? "Ascending; switch to descending" : "Descending; switch to ascending"}
                onClick={() => setSort((s) => ({ ...s, dir: s.dir === "asc" ? "desc" : "asc" }))}
              >
                {sort.dir === "asc" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
              </Button>
            </div>
          </PickerField>
          <div className="flex items-end">
            <Button type="button" variant="ghost" size="sm" disabled={active === 0} onClick={() => setFilters(EMPTY_FILTERS)}>
              <FilterX aria-hidden /> Clear filters
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-caption text-muted" aria-live="polite">
        {selected.length} selected · {visible.length} of {tracks.length} shown
        {active ? ` · ${active} filter${active === 1 ? "" : "s"} on` : ""}
      </p>
      <ul className="divide-y divide-divider overflow-y-auto rounded-control border border-control-border/50 bg-surface" style={{ maxHeight }}>
        {visible.map((t) => {
          const key = usableKey(t.keyTonic, t.keyMode, t.keyStatus);
          const checkboxId = `${id}-${t.id}`;
          return (
            <li key={t.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
              <Checkbox id={checkboxId} checked={selectedSet.has(t.id)} onCheckedChange={(v) => toggle(t.id, v === true)} />
              <label htmlFor={checkboxId} className="flex min-w-0 flex-1 cursor-pointer flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="truncate">
                  <span className="text-ink">{t.title}</span>
                  {t.versionLabel ? <span className="text-muted"> ({t.versionLabel})</span> : null}
                  <span className="text-muted"> · {t.artist || "Unknown artist"}</span>
                </span>
                <span className="shrink-0 text-data text-[13px] text-muted">
                  {t.bpm === null ? "BPM n/a" : `${formatBpm(t.bpm)} BPM`} · {key ? formatCamelot(toCamelot(key)) : "key n/a"} · E{" "}
                  {t.energy ?? "n/a"} · {formatTime(t.durationSeconds)}
                </span>
              </label>
            </li>
          );
        })}
        {visible.length === 0 ? <li className="px-3 py-4 text-muted">No tracks match.</li> : null}
      </ul>
      {name ? selected.map((trackId) => <input key={trackId} type="hidden" name={name} value={trackId} />) : null}
    </fieldset>
  );
}

function PickerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-eyebrow text-muted">{label}</span>
      {children}
    </div>
  );
}
