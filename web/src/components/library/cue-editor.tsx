"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { createCue, deleteCue, updateCue } from "@/app/actions/cues";
import { FormField } from "@/components/app/form-field";
import { FormMessage } from "@/components/app/form-message";
import { StatusBadge } from "@/components/app/status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatTime } from "@/lib/domain/format";
import type { CueRegion } from "@/lib/domain/types";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";

function CueForm({ trackId, cue, onDone }: { trackId: string; cue?: CueRegion; onDone?: () => void }) {
  const action = cue ? updateCue.bind(null, trackId, cue.id) : createCue.bind(null, trackId);
  const [state, formAction] = useActionState<ActionState, FormData>(action, initialActionState);
  const [formKey, setFormKey] = useState(0);
  const e = state.fieldErrors ?? {};
  const prefix = cue ? `cue-${cue.id}` : "cue-new";

  useEffect(() => {
    if (!state.ok) return;
    if (cue) onDone?.();
    else setFormKey((k) => k + 1);
  }, [state, cue, onDone]);

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id={`${prefix}-kind`} label="Kind" error={e.kind}>
          <NativeSelect name="kind" defaultValue={cue?.kind ?? "entry"}>
            <option value="entry">Entry (mix in)</option>
            <option value="exit">Exit (mix out)</option>
          </NativeSelect>
        </FormField>
        <FormField id={`${prefix}-start`} label="Start" helper="m:ss or seconds" error={e.start}>
          <Input name="start" defaultValue={cue ? formatTime(cue.startSeconds) : ""} className="text-data" />
        </FormField>
        <FormField id={`${prefix}-end`} label="End" helper="Region is [start, end)" error={e.end}>
          <Input name="end" defaultValue={cue ? formatTime(cue.endSeconds) : ""} className="text-data" />
        </FormField>
        <FormField id={`${prefix}-label`} label="Label" error={e.label}>
          <Input name="label" defaultValue={cue?.label} placeholder="Drum intro" maxLength={120} />
        </FormField>
        <FormField id={`${prefix}-provenance`} label="Source" error={e.provenance}>
          <NativeSelect name="provenance" defaultValue={cue?.provenance ?? "reviewed"}>
            <option value="reviewed">Set by me</option>
            <option value="estimate">Estimated boundary</option>
          </NativeSelect>
        </FormField>
        <FormField id={`${prefix}-review`} label="Review status" error={e.review_status}>
          <NativeSelect name="review_status" defaultValue={cue?.reviewStatus ?? "approved"}>
            <option value="approved">Approved for planning</option>
            <option value="pending">Pending review</option>
            <option value="rejected">Rejected (not used)</option>
          </NativeSelect>
        </FormField>
        <FormField id={`${prefix}-vocal`} label="Vocals in region" error={e.vocal_activity}>
          <NativeSelect name="vocal_activity" defaultValue={cue?.vocalActivity ?? "unknown"}>
            <option value="unknown">Not annotated</option>
            <option value="none">No vocals</option>
            <option value="present">Vocals present</option>
          </NativeSelect>
        </FormField>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel="Saving">
          {cue ? (
            "Save region"
          ) : (
            <>
              <Plus aria-hidden /> Add region
            </>
          )}
        </SubmitButton>
        {cue ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function reviewKind(cue: CueRegion) {
  if (cue.reviewStatus === "rejected") return "rejected" as const;
  if (cue.reviewStatus === "pending") return "pending" as const;
  return cue.provenance === "reviewed" ? ("reviewed" as const) : ("estimated" as const);
}

/** Dark timeline panel showing entry and exit regions on the track's time axis. */
function CueTimeline({ cues, duration }: { cues: CueRegion[]; duration: number }) {
  const ticks = Array.from({ length: 5 }, (_, i) => (duration * i) / 4);
  return (
    <div className="on-dark rounded-[12px] bg-dark p-6 text-on-dark">
      <div className="flex items-baseline justify-between">
        <h3 className="text-card-title text-on-dark">Cue regions</h3>
        <span className="text-data text-on-dark-muted">{formatTime(duration)}</span>
      </div>
      <div className="relative mt-6 h-20" aria-hidden>
        <div className="absolute inset-x-0 top-9 h-px bg-on-dark-muted/40" />
        {cues.map((c) => {
          const left = (c.startSeconds / duration) * 100;
          const width = Math.max(0.8, ((c.endSeconds - c.startSeconds) / duration) * 100);
          const entry = c.kind === "entry";
          return (
            <div
              key={c.id}
              className={`absolute h-6 rounded-[4px] border ${entry ? "top-2 border-data-rhythm-dark bg-data-rhythm-dark/30" : "top-11 border-data-energy-dark bg-data-energy-dark/30"} ${c.reviewStatus === "rejected" ? "opacity-40" : ""} ${c.reviewStatus === "pending" ? "border-dashed" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${entry ? "Entry" : "Exit"} ${formatTime(c.startSeconds)} to ${formatTime(c.endSeconds)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-data text-[12px] text-on-dark-muted" aria-hidden>
        {ticks.map((t) => (
          <span key={t}>{formatTime(t)}</span>
        ))}
      </div>
      <p className="mt-4 text-caption text-on-dark-muted">
        Upper row: entry regions (solid blue edge). Lower row: exit regions (solid red edge). Dashed edges are pending review; faded regions
        are rejected. The table below lists the same regions.
      </p>
    </div>
  );
}

export function CueEditor({ trackId, cues, duration }: { trackId: string; cues: CueRegion[]; duration: number }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionState>(initialActionState);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <CueTimeline cues={cues} duration={duration} />
      <Card>
        <CardHeader>
          <CardTitle>Entry and exit regions</CardTitle>
          <CardDescription>
            DJ plans only use approved or pending regions and flag anything not approved. Without a region, the planner falls back to a
            labelled intro or outro window and marks the transition for review. A region is a candidate mix point, not a verified phrase.
          </CardDescription>
        </CardHeader>
        {cues.length === 0 ? (
          <p className="text-muted">No regions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Start</TableHead>
                <TableHead className="text-right">End</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Vocals</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cues.map((c) =>
                editing === c.id ? (
                  <TableRow key={c.id}>
                    <TableCell colSpan={7} className="py-4">
                      <CueForm trackId={trackId} cue={c} onDone={() => setEditing(null)} />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={c.id}>
                    <TableCell>{c.kind === "entry" ? "Entry" : "Exit"}</TableCell>
                    <TableCell className="text-right text-data">{formatTime(c.startSeconds)}</TableCell>
                    <TableCell className="text-right text-data">{formatTime(c.endSeconds)}</TableCell>
                    <TableCell>{c.label || <span className="text-muted">None</span>}</TableCell>
                    <TableCell>{c.vocalActivity === "present" ? "Present" : c.vocalActivity === "none" ? "None" : "Not annotated"}</TableCell>
                    <TableCell>
                      <StatusBadge kind={reviewKind(c)} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" aria-label={`Edit ${c.kind} region at ${formatTime(c.startSeconds)}`} onClick={() => setEditing(c.id)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        aria-label={`Delete ${c.kind} region at ${formatTime(c.startSeconds)}`}
                        onClick={() =>
                          startTransition(async () => {
                            setMessage(await deleteCue(trackId, c.id));
                          })
                        }
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
        <div className="mt-4">
          <FormMessage state={message} />
        </div>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add a region</CardTitle>
        </CardHeader>
        <CueForm trackId={trackId} />
      </Card>
    </div>
  );
}
