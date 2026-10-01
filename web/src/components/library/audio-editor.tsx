"use client";

import { Check, Pause, Play, Plus, Repeat, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createCue, updateCue } from "@/app/actions/cues";
import { FormMessage } from "@/components/app/form-message";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { decodeFile } from "@/lib/analysis/client";
import { assetId as computeAssetId } from "@/lib/analysis/metadata";
import { formatTime } from "@/lib/domain/format";
import type { CueRegion } from "@/lib/domain/types";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";

interface Grid {
  beats: number[];
  downbeats: number[];
}

const HEIGHT = 180;
const RULER = 22;
const COLORS = {
  wave: "#C4D0D8",
  beat: "rgba(120, 184, 255, 0.45)",
  downbeat: "#78B8FF",
  entry: "rgba(120, 184, 255, 0.22)",
  entryEdge: "#78B8FF",
  exit: "rgba(255, 123, 104, 0.22)",
  exitEdge: "#FF7B68",
  selection: "rgba(248, 250, 252, 0.18)",
  playhead: "#F8FAFC",
  text: "#C4D0D8",
};

type Drag =
  | { kind: "select"; anchor: number }
  | { kind: "edge"; cueId: string; edge: "start" | "end" }
  | { kind: "seek" };

function peaksFromChannels(channels: Float32Array[], buckets: number): number[] {
  const n = channels[0]?.length ?? 0;
  const size = n / buckets;
  const peaks: number[] = [];
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    let p = 0;
    for (let i = Math.floor(b * size); i < Math.floor((b + 1) * size); i++) {
      for (const ch of channels) p = Math.max(p, Math.abs(ch[i]!));
    }
    peaks.push(p);
    max = Math.max(max, p);
  }
  return peaks.map((p) => (max > 0 ? p / max : 0));
}

function toFormData(cue: { kind: string; start: number; end: number; label: string; provenance: string; reviewStatus: string; vocalActivity: string }) {
  const fd = new FormData();
  fd.set("kind", cue.kind);
  fd.set("start", cue.start.toFixed(3));
  fd.set("end", cue.end.toFixed(3));
  fd.set("label", cue.label);
  fd.set("provenance", cue.provenance);
  fd.set("review_status", cue.reviewStatus);
  fd.set("vocal_activity", cue.vocalActivity);
  return fd;
}

/**
 * Waveform with beat and downbeat markers, cue regions, and playback of a local file.
 * Audio stays in the browser. Regions snap to detected beats when a grid is available;
 * edits save through the same cue actions as the table, which remains the full editor.
 */
export function AudioEditor({
  trackId,
  duration,
  trackAssetId,
  cues,
  grid,
  storedPeaks,
}: {
  trackId: string;
  duration: number;
  trackAssetId: string | null;
  cues: CueRegion[];
  grid: Grid | null;
  storedPeaks: number[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(storedPeaks);
  const [fileNote, setFileNote] = useState<{ tone: "warning" | "neutral"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const [snap, setSnap] = useState(true);
  const [loop, setLoop] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [selectedCue, setSelectedCue] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { start: number; end: number }>>({});
  const [message, setMessage] = useState<ActionState>(initialActionState);
  const [pending, startTransition] = useTransition();
  const drag = useRef<Drag | null>(null);

  const beats = useMemo(() => grid?.beats ?? [], [grid]);
  const downbeatSet = useMemo(() => new Set(grid?.downbeats ?? []), [grid]);
  const contentWidth = Math.max(width, Math.round(width * zoom));
  const x = useCallback((t: number) => (t / duration) * contentWidth, [duration, contentWidth]);
  const t = useCallback((px: number) => Math.min(duration, Math.max(0, (px / contentWidth) * duration)), [duration, contentWidth]);
  const beatPeriod = beats.length > 1 ? (beats[beats.length - 1]! - beats[0]!) / (beats.length - 1) : null;

  const snapTime = useCallback(
    (value: number) => {
      if (!snap || beats.length === 0) return value;
      let best = beats[0]!;
      for (const b of beats) if (Math.abs(b - value) < Math.abs(best - value)) best = b;
      return best;
    },
    [snap, beats],
  );

  const regionOf = useCallback((c: CueRegion) => edits[c.id] ?? { start: c.startSeconds, end: c.endSeconds }, [edits]);

  // Track the container width for a crisp canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = contentWidth * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${contentWidth}px`;
    canvas.style.height = `${HEIGHT}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, contentWidth, HEIGHT);
    const mid = RULER + (HEIGHT - RULER) / 2;
    const amp = (HEIGHT - RULER) / 2 - 6;

    for (const c of cues) {
      if (c.reviewStatus === "rejected") continue;
      const r = regionOf(c);
      const entry = c.kind === "entry";
      g.fillStyle = entry ? COLORS.entry : COLORS.exit;
      g.fillRect(x(r.start), RULER, x(r.end) - x(r.start), HEIGHT - RULER);
      g.strokeStyle = entry ? COLORS.entryEdge : COLORS.exitEdge;
      g.lineWidth = c.id === selectedCue ? 3 : 1.5;
      g.setLineDash(c.reviewStatus === "pending" ? [5, 4] : []);
      g.strokeRect(x(r.start) + 0.5, RULER + 0.5, x(r.end) - x(r.start) - 1, HEIGHT - RULER - 1);
      g.setLineDash([]);
    }

    if (peaks) {
      g.fillStyle = COLORS.wave;
      const n = peaks.length;
      const bar = Math.max(1, contentWidth / n);
      for (let i = 0; i < n; i++) {
        const h = Math.max(1, peaks[i]! * amp);
        g.fillRect((i / n) * contentWidth, mid - h, Math.ceil(bar), h * 2);
      }
    } else {
      g.fillStyle = COLORS.text;
      g.font = "13px system-ui, sans-serif";
      g.fillText("Open the audio file to see its waveform", 12, mid);
    }

    const pxPerBeat = beatPeriod ? x(beatPeriod) : 0;
    for (const b of beats) {
      const isDown = downbeatSet.has(b);
      if (!isDown && pxPerBeat < 4) continue;
      g.fillStyle = isDown ? COLORS.downbeat : COLORS.beat;
      g.fillRect(Math.round(x(b)), isDown ? 4 : 12, isDown ? 2 : 1, isDown ? RULER - 4 : RULER - 12);
    }

    if (selection) {
      g.fillStyle = COLORS.selection;
      g.fillRect(x(selection.start), RULER, x(selection.end) - x(selection.start), HEIGHT - RULER);
    }

    g.fillStyle = COLORS.playhead;
    g.fillRect(Math.round(x(time)), 0, 2, HEIGHT);
  }, [contentWidth, peaks, beats, downbeatSet, beatPeriod, cues, regionOf, selectedCue, selection, time, x]);

  // Keep the playhead in view while zoomed.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || zoom === 1 || !playing) return;
    const px = x(time);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, px - el.clientWidth / 4);
  }, [time, zoom, playing, x]);

  // Playback clock and loop.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setTime(audio.currentTime);
        const region = selectedRegion();
        if (loop && region && audio.currentTime >= region.end) audio.currentTime = region.start;
      }
      frame = requestAnimationFrame(tick);
    };
    if (playing) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  const selectedRegion = () => {
    if (selectedCue) {
      const c = cues.find((q) => q.id === selectedCue);
      if (c) return regionOf(c);
    }
    return selection;
  };

  const openFile = async (file: File) => {
    setLoading(true);
    setFileNote(null);
    try {
      const bytes = await file.arrayBuffer();
      const id = await computeAssetId(bytes);
      if (trackAssetId && id !== trackAssetId) {
        setFileNote({ tone: "warning", text: "This file is not the one this track was analyzed from (different content hash). Cue times may not line up." });
      }
      const decoded = await decodeFile(bytes);
      setPeaks(peaksFromChannels(decoded.channels, 1600));
      const decodedSeconds = (decoded.channels[0]?.length ?? 0) / decoded.sampleRate;
      if (Math.abs(decodedSeconds - duration) > 1) {
        setFileNote({ tone: "warning", text: `The file is ${formatTime(decodedSeconds)} long but the track says ${formatTime(duration)}.` });
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(file));
      setTime(0);
      setPlaying(false);
    } catch (error) {
      setFileNote({ tone: "warning", text: `This browser could not open the file (${(error as Error).message}).` });
    } finally {
      setLoading(false);
    }
  };

  const seek = (value: number) => {
    setTime(value);
    if (audioRef.current) audioRef.current.currentTime = value;
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      const region = selectedRegion();
      if (loop && region && (audio.currentTime < region.start || audio.currentTime >= region.end)) audio.currentTime = region.start;
      await audio.play();
    } else audio.pause();
  };

  const pointerTime = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return t(e.clientX - rect.left);
  };

  const hitEdge = (time: number): { cueId: string; edge: "start" | "end" } | null => {
    const tolerance = (6 / contentWidth) * duration;
    for (const c of cues) {
      if (c.reviewStatus === "rejected") continue;
      const r = regionOf(c);
      if (Math.abs(time - r.start) <= tolerance) return { cueId: c.id, edge: "start" };
      if (Math.abs(time - r.end) <= tolerance) return { cueId: c.id, edge: "end" };
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    const at = pointerTime(e);
    const edge = hitEdge(at);
    if (edge) {
      drag.current = { kind: "edge", ...edge };
      setSelectedCue(edge.cueId);
      setSelection(null);
      return;
    }
    const inside = cues.find((c) => c.reviewStatus !== "rejected" && at >= regionOf(c).start && at <= regionOf(c).end);
    if (inside && e.altKey === false && e.shiftKey === false) {
      setSelectedCue(inside.id);
      setSelection(null);
      drag.current = { kind: "seek" };
      seek(at);
      return;
    }
    setSelectedCue(null);
    drag.current = { kind: "select", anchor: snapTime(at) };
    setSelection(null);
    seek(at);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const at = pointerTime(e);
    if (canvasRef.current) canvasRef.current.style.cursor = hitEdge(at) ? "ew-resize" : "crosshair";
    if (!d) return;
    if (d.kind === "select") {
      const end = snapTime(at);
      if (Math.abs(x(end) - x(d.anchor)) > 3) setSelection({ start: Math.min(d.anchor, end), end: Math.max(d.anchor, end) });
    } else if (d.kind === "edge") {
      const c = cues.find((q) => q.id === d.cueId)!;
      const r = regionOf(c);
      const value = snapTime(at);
      const next = d.edge === "start" ? { start: Math.min(value, r.end - 0.05), end: r.end } : { start: r.start, end: Math.max(value, r.start + 0.05) };
      setEdits((prev) => ({ ...prev, [c.id]: { start: Math.max(0, next.start), end: Math.min(duration, next.end) } }));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const run = (task: () => Promise<ActionState>) =>
    startTransition(async () => {
      const result = await task();
      setMessage(result);
    });

  const addRegion = (kind: "entry" | "exit") => {
    if (!selection) return;
    run(async () => {
      const res = await createCue(
        trackId,
        initialActionState,
        toFormData({
          kind,
          start: selection.start,
          end: selection.end,
          label: kind === "entry" ? "Entry (waveform)" : "Exit (waveform)",
          provenance: "reviewed",
          reviewStatus: "approved",
          vocalActivity: "unknown",
        }),
      );
      if (res.ok) setSelection(null);
      return res;
    });
  };

  const selected = cues.find((c) => c.id === selectedCue) ?? null;

  const saveCue = (c: CueRegion, patch: Partial<{ start: number; end: number; reviewStatus: string; provenance: string }>) =>
    run(async () => {
      const r = regionOf(c);
      const res = await updateCue(
        trackId,
        c.id,
        initialActionState,
        toFormData({
          kind: c.kind,
          start: patch.start ?? r.start,
          end: patch.end ?? r.end,
          label: c.label,
          provenance: patch.provenance ?? c.provenance,
          reviewStatus: patch.reviewStatus ?? c.reviewStatus,
          vocalActivity: c.vocalActivity,
        }),
      );
      if (res.ok)
        setEdits((prev) => {
          const next = { ...prev };
          delete next[c.id];
          return next;
        });
      return res;
    });

  const nudge = (c: CueRegion, edge: "start" | "end", direction: -1 | 1) => {
    const r = regionOf(c);
    const step = beatPeriod ?? 0.5;
    const value = snapTime(r[edge] + direction * step);
    const next = edge === "start" ? { start: Math.max(0, Math.min(value, r.end - 0.05)), end: r.end } : { start: r.start, end: Math.min(duration, Math.max(value, r.start + 0.05)) };
    setEdits((prev) => ({ ...prev, [c.id]: next }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waveform and cues</CardTitle>
        <CardDescription>
          Open your copy of the track to play it here; it is not uploaded. Drag across the waveform to select a region, drag a region&apos;s edge to
          resize it, and click a region to review it. {beats.length ? "Edges snap to the detected beats." : "Analyze the file to get beat markers."}
        </CardDescription>
      </CardHeader>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`audio-file-${trackId}`}>Audio file</Label>
          <input
            id={`audio-file-${trackId}`}
            type="file"
            accept="audio/*"
            className="text-[14px] file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-[8px] file:border file:border-control-border file:bg-surface file:px-4 file:text-ui file:text-ink"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
            }}
          />
        </div>
        {loading ? <span className="text-caption text-muted">Decoding…</span> : null}
      </div>
      {fileNote ? (
        <Alert tone={fileNote.tone} className="mt-4">
          {fileNote.text}
        </Alert>
      ) : null}

      <div className="on-dark mt-6 rounded-[12px] bg-dark p-4 text-on-dark">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="dark" size="icon" onClick={togglePlay} disabled={!audioUrl} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          </Button>
          <span className="text-data text-on-dark" aria-live="off">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <label className="inline-flex min-h-11 items-center gap-2 text-caption text-on-dark-muted">
            <Checkbox checked={loop} onCheckedChange={(v) => setLoop(v === true)} className="border-on-dark-muted bg-dark-elevated" />
            <Repeat className="size-4" aria-hidden /> Loop selection
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-caption text-on-dark-muted">
            <Checkbox checked={snap} onCheckedChange={(v) => setSnap(v === true)} disabled={beats.length === 0} className="border-on-dark-muted bg-dark-elevated" />
            Snap to beats
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor={`zoom-${trackId}`} className="text-on-dark-muted">
              Zoom
            </Label>
            <NativeSelect id={`zoom-${trackId}`} value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))} className="min-h-9 w-24 border-on-dark-muted/50 bg-dark-elevated py-1 text-on-dark">
              {[1, 2, 4, 8, 16].map((z) => (
                <option key={z} value={z}>
                  {z}×
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div ref={wrapRef} className="mt-3 overflow-x-auto overscroll-x-contain rounded-[8px] bg-dark-elevated">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Waveform of ${formatTime(duration)} with ${cues.length} cue regions${beats.length ? ` and ${beats.length} beat markers` : ""}. Use the controls and the table below for keyboard access.`}
            className="block touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Playback position"
          className="mt-3 w-full accent-[#8FC4FF]"
        />
        <p className="mt-2 text-caption text-on-dark-muted">
          Blue regions are entries, red are exits; dashed edges are pending review. Tall blue ticks are downbeats from the model, short ticks
          are beats.
        </p>
        {audioUrl ? (
          <audio ref={audioRef} src={audioUrl} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3" aria-live="polite">
        {selection ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-data">
              Selection {formatTime(selection.start)} to {formatTime(selection.end)}
              {beatPeriod ? ` (${Math.round((selection.end - selection.start) / beatPeriod)} beats)` : ""}
            </span>
            <Button size="sm" onClick={() => addRegion("entry")} disabled={pending}>
              <Plus aria-hidden /> Add entry region
            </Button>
            <Button size="sm" variant="secondary" onClick={() => addRegion("exit")} disabled={pending}>
              <Plus aria-hidden /> Add exit region
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
              Clear
            </Button>
          </div>
        ) : null}

        {selected ? (
          <div className="flex flex-col gap-3 rounded-[8px] border border-divider p-4">
            <p className="text-ui text-ink">
              {selected.kind === "entry" ? "Entry" : "Exit"} region: {selected.label || "Unlabelled"}{" "}
              <span className="text-data font-normal text-muted">
                {formatTime(regionOf(selected).start)} to {formatTime(regionOf(selected).end)}
              </span>
              {selected.reviewStatus === "pending" ? <span className="ml-2 text-caption text-warning">Pending review</span> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => nudge(selected, "start", -1)}>
                Start −1 beat
              </Button>
              <Button size="sm" variant="secondary" onClick={() => nudge(selected, "start", 1)}>
                Start +1 beat
              </Button>
              <Button size="sm" variant="secondary" onClick={() => nudge(selected, "end", -1)}>
                End −1 beat
              </Button>
              <Button size="sm" variant="secondary" onClick={() => nudge(selected, "end", 1)}>
                End +1 beat
              </Button>
              <Button size="sm" variant="secondary" onClick={() => seek(regionOf(selected).start)} disabled={!audioUrl}>
                Go to start
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {edits[selected.id] ? (
                <Button size="sm" onClick={() => saveCue(selected, {})} disabled={pending}>
                  Save new times
                </Button>
              ) : null}
              {selected.reviewStatus !== "approved" || selected.provenance !== "reviewed" ? (
                <Button size="sm" onClick={() => saveCue(selected, { reviewStatus: "approved", provenance: "reviewed" })} disabled={pending}>
                  <Check aria-hidden /> Approve{edits[selected.id] ? " with new times" : ""}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => saveCue(selected, { reviewStatus: "rejected" })} disabled={pending}>
                <X aria-hidden /> Reject
              </Button>
              {edits[selected.id] ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setEdits((prev) => {
                      const next = { ...prev };
                      delete next[selected.id];
                      return next;
                    })
                  }
                >
                  Undo changes
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <FormMessage state={message} />
      </div>
    </Card>
  );
}
