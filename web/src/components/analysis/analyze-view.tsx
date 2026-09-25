"use client";

import { CheckCircle2, FileAudio, Loader2, Upload, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveAnalyses, type SaveOutcome } from "@/app/actions/analysis";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnalysisClient, MODEL_MANIFEST_URL, type AnalyzedFile, type ClientProgress } from "@/lib/analysis/client";
import { formatTime } from "@/lib/domain/format";
import { keyLabel, lufs, tempoSourceLabel } from "./format";

export interface LibraryTrackRef {
  id: string;
  title: string;
  artist: string;
  assetId: string | null;
}

type Status = "waiting" | "running" | "done" | "error";

interface Item {
  key: string;
  file: File;
  status: Status;
  progress: ClientProgress | null;
  analyzed: AnalyzedFile | null;
  error: string | null;
  include: boolean;
  title: string;
  artist: string;
  /** "" means match by audio file, creating a new track when there is no match. */
  target: string;
  outcome: SaveOutcome | null;
}

const STAGE_LABEL: Record<string, string> = {
  hashing: "Reading file",
  decoding: "Decoding audio",
  features: "Measuring frames",
  tempo: "Estimating tempo",
  beats: "Detecting beats",
  key: "Estimating key",
  loudness: "Measuring loudness",
  structure: "Finding sections",
  done: "Finishing",
};

const ACCEPT = "audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.aif,.aiff";

type ModelState = { kind: "checking" } | { kind: "available"; name: string } | { kind: "missing" } | { kind: "error"; message: string };

export function AnalyzeView({ tracks }: { tracks: LibraryTrackRef[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState<ModelState>({ kind: "checking" });
  const [saving, startSaving] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const client = useRef<AnalysisClient | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const byAsset = useMemo(() => new Map(tracks.filter((t) => t.assetId).map((t) => [t.assetId!, t])), [tracks]);

  useEffect(() => {
    let cancelled = false;
    fetch(MODEL_MANIFEST_URL, { cache: "no-cache" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) setModel({ kind: "missing" });
        else if (!r.ok) setModel({ kind: "error", message: `manifest request failed (${r.status})` });
        else setModel({ kind: "available", name: ((await r.json()) as { name?: string }).name ?? "Beat This!" });
      })
      .catch((e: Error) => !cancelled && setModel({ kind: "error", message: e.message }));
    return () => {
      cancelled = true;
      client.current?.dispose();
    };
  }, []);

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff?)$/i.test(f.name))
      .map<Item>((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        status: "waiting",
        progress: null,
        analyzed: null,
        error: null,
        include: true,
        title: "",
        artist: "",
        target: "",
        outcome: null,
      }));
    setItems((list) => [...list, ...next]);
  };

  const runQueue = async () => {
    if (running) return;
    setRunning(true);
    client.current ??= new AnalysisClient();
    const queue = items.filter((it) => it.status === "waiting");
    for (const item of queue) {
      update(item.key, { status: "running" });
      try {
        const analyzed = await client.current.analyzeFile(item.file, (progress) => update(item.key, { progress }));
        const match = byAsset.get(analyzed.assetId);
        update(item.key, {
          status: "done",
          analyzed,
          title: match?.title ?? analyzed.tags.title,
          artist: match?.artist ?? analyzed.tags.artist,
          target: match?.id ?? "",
        });
      } catch (error) {
        const message = (error as Error).message || "analysis failed";
        update(item.key, {
          status: "error",
          error: /decod|EncodingError|Unable to decode/i.test(message) ? `This browser could not decode the file (${message}).` : message,
        });
      }
    }
    setRunning(false);
  };

  const ready = items.filter((it) => it.status === "done" && it.include && !it.outcome?.ok);

  const save = () =>
    startSaving(async () => {
      for (let i = 0; i < ready.length; i += 10) {
        const batch = ready.slice(i, i + 10);
        const outcomes = await saveAnalyses(
          batch.map((it) => ({
            assetId: it.analyzed!.assetId,
            fileName: it.file.name,
            title: it.title.trim() || it.analyzed!.tags.title,
            artist: it.artist.trim(),
            trackId: it.target || null,
            result: it.analyzed!.result,
          })),
        );
        batch.forEach((it, j) => update(it.key, { outcome: outcomes[j] ?? null }));
      }
    });

  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div className="flex flex-col gap-6">
      <ModelNotice model={model} />

      <Card>
        <CardHeader>
          <CardTitle>Audio files</CardTitle>
          <CardDescription>
            Files are decoded and analyzed in this browser. Audio is never uploaded; only the measurements you save are stored.
          </CardDescription>
        </CardHeader>
        <div
          className={`flex flex-col items-center gap-3 rounded-[12px] border-2 border-dashed p-8 text-center ${dragOver ? "border-action bg-action/5" : "border-control-border/50"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="size-6 text-muted" aria-hidden />
          <p>Drop audio files here, or</p>
          <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="Choose audio files"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-caption text-muted">MP3, AAC/M4A, WAV, FLAC, and Ogg in most browsers. ALAC and AIFF depend on the browser.</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={runQueue} disabled={running || !items.some((it) => it.status === "waiting")} aria-busy={running}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {running ? "Analyzing" : `Analyze ${items.filter((it) => it.status === "waiting").length} file(s)`}
          </Button>
          <Button variant="secondary" onClick={() => setItems((l) => l.filter((it) => it.status === "running"))} disabled={items.length === 0 || running}>
            Clear list
          </Button>
          <p className="text-caption text-muted" aria-live="polite">
            {doneCount} of {items.length} analyzed. Files run one at a time; a long track can take a minute with the beat model.
          </p>
        </div>
      </Card>

      {items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Review before saving</CardTitle>
            <CardDescription>
              Values are saved as estimates. Tempo and key never replace values you have reviewed. Cue suggestions arrive as pending regions for
              you to check on the track page.
            </CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="sr-only">Include</span>
                </TableHead>
                <TableHead>File and track</TableHead>
                <TableHead>Save to</TableHead>
                <TableHead className="text-right">Tempo</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Loudness</TableHead>
                <TableHead>Beat grid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <ItemRow key={it.key} item={it} tracks={tracks} onChange={(patch) => update(it.key, patch)} />
              ))}
            </TableBody>
          </Table>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving || running || ready.length === 0} aria-busy={saving}>
              {saving ? "Saving" : `Save ${ready.length} analysis result(s)`}
            </Button>
            <Button asChild variant="secondary">
              <Link href="/library">Back to library</Link>
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ModelNotice({ model }: { model: ModelState }) {
  if (model.kind === "checking") return null;
  if (model.kind === "available") {
    return (
      <Alert tone="success">
        Beat and downbeat detection uses the {model.name} model in this browser. It is downloaded once, checked against its SHA-256, and cached.
      </Alert>
    );
  }
  return (
    <Alert tone="warning">
      <AlertTitle>The beat detection model is not installed on this site</AlertTitle>
      <p className="mt-1">
        Analysis still works, using the fallback beat tracker. It finds beats and tempo but no downbeats, so bar positions and cue suggestions
        start at the first beat rather than the first bar. {model.kind === "error" ? `(${model.message})` : "See the web README to publish the model."}
      </p>
    </Alert>
  );
}

function ItemRow({ item, tracks, onChange }: { item: Item; tracks: LibraryTrackRef[]; onChange: (patch: Partial<Item>) => void }) {
  const r = item.analyzed?.result;
  const idBase = `item-${item.key.replace(/[^a-z0-9]/gi, "")}`;
  const progressText =
    item.status === "running" && item.progress ? `${STAGE_LABEL[item.progress.stage] ?? item.progress.stage} ${Math.round(item.progress.fraction * 100)}%` : null;
  return (
    <TableRow className="align-top">
      <TableCell>
        <Checkbox
          checked={item.include}
          disabled={item.status !== "done" || item.outcome?.ok}
          onCheckedChange={(v) => onChange({ include: v === true })}
          aria-label={`Include ${item.file.name}`}
        />
      </TableCell>
      <TableCell className="min-w-[240px]">
        <p className="flex items-center gap-2 text-caption text-muted">
          <FileAudio className="size-4 shrink-0" aria-hidden />
          <span className="truncate" title={item.file.name}>
            {item.file.name}
          </span>
        </p>
        {r ? (
          <div className="mt-2 grid gap-2">
            <Input aria-label={`Title for ${item.file.name}`} value={item.title} onChange={(e) => onChange({ title: e.target.value })} disabled={item.outcome?.ok} />
            <Input
              aria-label={`Artist for ${item.file.name}`}
              placeholder="Artist"
              value={item.artist}
              onChange={(e) => onChange({ artist: e.target.value })}
              disabled={item.outcome?.ok}
            />
            <p className="text-caption text-muted">{formatTime(r.durationSeconds)} · {r.sampleRate / 1000} kHz · {r.channelCount} ch</p>
          </div>
        ) : null}
      </TableCell>
      <TableCell className="min-w-[200px]">
        {r ? (
          <NativeSelect
            id={`${idBase}-target`}
            aria-label={`Save ${item.file.name} to`}
            value={item.target}
            onChange={(e) => onChange({ target: e.target.value })}
            disabled={item.outcome?.ok}
          >
            <option value="">Match by audio file, or add new</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.artist ? ` · ${t.artist}` : ""}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {r ? (
          <>
            <span className="text-data">{r.tempo.bpm === null ? "n/a" : r.tempo.bpm.toFixed(1)}</span>
            <div className="text-caption text-muted">{tempoSourceLabel(r.tempo.source)}</div>
            {r.tempo.alternatives.length ? <div className="text-caption text-muted">alt. {r.tempo.alternatives.map((b) => b.toFixed(0)).join(", ")}</div> : null}
          </>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {r ? (
          <>
            <span className="text-data">{keyLabel(r.key)}</span>
            <div className="mt-1">
              <StatusBadge kind={r.key.status === "estimated" ? "estimated" : "uncertain"} />
            </div>
            <div className="text-caption text-muted">margin {r.key.margin.toFixed(2)}</div>
          </>
        ) : null}
      </TableCell>
      <TableCell className="text-right text-data whitespace-nowrap">
        {r ? (
          <>
            {lufs(r.loudness.integratedLufs)}
            <div className="font-sans text-caption text-muted">range {r.loudness.loudnessRangeLu === null ? "n/a" : `${r.loudness.loudnessRangeLu.toFixed(1)} LU`}</div>
          </>
        ) : null}
      </TableCell>
      <TableCell className="min-w-[180px]">
        {r ? (
          r.rhythm.chosen ? (
            <>
              <StatusBadge kind="reviewed" label={r.rhythm.chosen === "beat_this" ? "Reliable (model)" : "Reliable (fallback)"} />
              <div className="mt-1 text-caption text-muted">
                {r.rhythm.beats.length} beats{r.rhythm.downbeats.length ? `, ${r.rhythm.downbeats.length} bars` : ", no bar lines"}
              </div>
            </>
          ) : (
            <>
              <StatusBadge kind="review" label="No reliable grid" />
              <details className="mt-1 text-caption text-muted">
                <summary className="cursor-pointer">Why</summary>
                <ul className="list-disc pl-4">
                  {r.rhythm.reasons.slice(0, 4).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            </>
          )
        ) : null}
      </TableCell>
      <TableCell className="min-w-[180px]" aria-live="polite">
        {item.status === "waiting" ? <span className="text-muted">Waiting</span> : null}
        {item.status === "running" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {progressText ?? "Starting"}
          </span>
        ) : null}
        {item.status === "error" ? (
          <span className="inline-flex items-start gap-2 text-error">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {item.error}
          </span>
        ) : null}
        {item.status === "done" && !item.outcome ? <span className="text-muted">Ready to save</span> : null}
        {item.outcome ? (
          item.outcome.ok ? (
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                {item.outcome.message}
              </span>
              {item.outcome.trackId ? <Link href={`/library/${item.outcome.trackId}`}>Open track</Link> : null}
              {item.outcome.kept.length ? <span className="text-caption text-muted">Kept: {item.outcome.kept.join(", ")}</span> : null}
              {item.outcome.warnings.map((w) => (
                <span key={w} className="text-caption text-warning">
                  {w}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-error">{item.outcome.message}</span>
          )
        ) : null}
        {r?.warnings.length && item.status === "done" && !item.outcome ? (
          <details className="mt-1 text-caption text-muted">
            <summary className="cursor-pointer">{r.warnings.length} note(s)</summary>
            <ul className="list-disc pl-4">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
