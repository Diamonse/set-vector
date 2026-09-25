"use client";

import { useActionState, useMemo, useState } from "react";
import { importLibrary, type ImportState } from "@/app/actions/import";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/submit-button";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { describeTrackKey } from "@/lib/domain/camelot";
import { formatTime } from "@/lib/domain/format";
import { parseLibrary } from "@/lib/import/parse";

const initial: ImportState = { ok: false, message: "", imported: 0, skipped: 0, problems: [] };

export function ImportForm() {
  const [state, formAction] = useActionState(importLibrary, initial);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");

  const preview = useMemo(() => (text.trim() ? parseLibrary(text) : null), [text]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Source</CardTitle>
          <CardDescription>
            JSON (an array or <code>{'{"tracks": [...]}'}</code>) or CSV with a header row. Values are imported as estimates unless the file
            marks them reviewed. Rows with an asset ID already in your library are skipped.
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4">
          <FormField id="file" label="File" helper="Up to 3.5 MB. The preview below reads the file locally before anything is sent.">
            <Input
              name="file"
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setFileName(file?.name ?? "");
                setText(file ? await file.text() : "");
              }}
            />
          </FormField>
          {!fileName ? (
            <FormField id="text" label="Or paste JSON or CSV">
              <Textarea name="text" rows={10} className="text-data" value={text} onChange={(e) => setText(e.target.value)} />
            </FormField>
          ) : null}
        </div>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {preview.tracks.length} track(s) ready from {preview.format.toUpperCase()}; {preview.problems.length} issue(s).
            </CardDescription>
          </CardHeader>
          {preview.problems.length > 0 ? (
            <Alert tone="warning" className="mb-4">
              <ul className="list-disc pl-5">
                {preview.problems.slice(0, 20).map((p, i) => (
                  <li key={i}>
                    {p.row > 0 ? `Row ${p.row}: ` : ""}
                    {p.message}
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead className="text-right">Length</TableHead>
                <TableHead className="text-right">BPM</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Energy</TableHead>
                <TableHead className="text-right">Cues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.tracks.slice(0, 50).map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>{t.artist}</TableCell>
                  <TableCell className="text-right text-data">{formatTime(t.duration_seconds)}</TableCell>
                  <TableCell className="text-right text-data">{t.bpm ?? "n/a"}</TableCell>
                  <TableCell className="text-caption">{describeTrackKey(t.key_tonic, t.key_mode, t.key_status)}</TableCell>
                  <TableCell className="text-right text-data">{t.energy ?? "n/a"}</TableCell>
                  <TableCell className="text-right text-data">{t.cues.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preview.tracks.length > 50 ? <p className="mt-3 text-caption text-muted">Showing the first 50 rows.</p> : null}
        </Card>
      ) : null}

      {state.message ? (
        <Alert tone={state.ok ? "success" : "error"} aria-live="polite">
          <p>{state.message}</p>
          {state.problems.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-caption">
              {state.problems.slice(0, 20).map((p, i) => (
                <li key={i}>
                  {p.row > 0 ? `Row ${p.row}: ` : ""}
                  {p.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <div>
        <SubmitButton disabled={!preview || preview.tracks.length === 0} pendingLabel="Importing">
          Import {preview ? preview.tracks.length : 0} track(s)
        </SubmitButton>
      </div>
    </form>
  );
}
