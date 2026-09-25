"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatCamelot, toCamelot, usableKey } from "@/lib/domain/camelot";
import { formatBpm, formatTime } from "@/lib/domain/format";

export interface PickerTrack {
  id: string;
  title: string;
  artist: string;
  versionLabel: string;
  durationSeconds: number;
  bpm: number | null;
  keyTonic: number | null;
  keyMode: "major" | "minor" | null;
  keyStatus: "unknown" | "estimated" | "reviewed" | "uncertain" | "not_meaningful";
  energy: number | null;
  styleTags: string[];
}

/**
 * Filterable checkbox list. When `name` is set, selected IDs are also
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
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) => `${t.title} ${t.artist} ${t.versionLabel} ${t.styleTags.join(" ")}`.toLowerCase().includes(q));
  }, [tracks, query]);

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
          aria-label={`Filter ${label.toLowerCase()}`}
          placeholder="Filter by title, artist, or style"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex shrink-0 gap-2">
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
      <p className="text-caption text-muted" aria-live="polite">
        {selected.length} selected · {visible.length} shown
      </p>
      <ul className="divide-y divide-divider overflow-y-auto rounded-[8px] border border-control-border/50 bg-surface" style={{ maxHeight }}>
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
