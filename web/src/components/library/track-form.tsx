"use client";

import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCamelot, toCamelot } from "@/lib/domain/camelot";
import { formatTime } from "@/lib/domain/format";
import { STYLE_SUGGESTIONS, type Track } from "@/lib/domain/types";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function TrackForm({ track, action, submitLabel }: { track?: Track; action: Action; submitLabel: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  const e = state.fieldErrors ?? {};
  const keyText = track && track.keyTonic !== null && track.keyMode ? formatCamelot(toCamelot({ tonic: track.keyTonic, mode: track.keyMode })) : "";

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Remix family groups originals and edits so the planner can space them apart.</CardDescription>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField id="title" label="Title" error={e.title}>
            <Input name="title" defaultValue={track?.title} required maxLength={300} />
          </FormField>
          <FormField id="artist" label="Artist" error={e.artist}>
            <Input name="artist" defaultValue={track?.artist} maxLength={300} />
          </FormField>
          <FormField id="version_label" label="Version or edit" helper="For example: Extended Mix, BollyHouse Edit." error={e.version_label}>
            <Input name="version_label" defaultValue={track?.versionLabel} maxLength={200} />
          </FormField>
          <FormField id="remix_group" label="Remix family" helper="Use the same text for related versions." error={e.remix_group}>
            <Input name="remix_group" defaultValue={track?.remixGroup} maxLength={200} />
          </FormField>
          <FormField id="duration" label="Duration" helper="m:ss, h:mm:ss, or seconds." error={e.duration}>
            <Input name="duration" defaultValue={track ? formatTime(track.durationSeconds) : ""} required inputMode="decimal" className="text-data" />
          </FormField>
          <FormField
            id="style_tags"
            label="Style tags"
            helper={`Comma separated; tracks may carry several. Common: ${STYLE_SUGGESTIONS.join(", ")}.`}
            error={e.style_tags}
          >
            <Input name="style_tags" defaultValue={track?.styleTags.join(", ")} list="style-suggestions" />
          </FormField>
          <datalist id="style-suggestions">
            {STYLE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Measurements</CardTitle>
          <CardDescription>
            Mark each value as an estimate or as reviewed by you. Leave a field empty when it is unknown; the planner shows missing
            evidence instead of guessing.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField id="bpm" label="Tempo (BPM)" error={e.bpm}>
            <Input name="bpm" defaultValue={track?.bpm ?? ""} inputMode="decimal" className="text-data" />
          </FormField>
          <FormField id="bpm_source" label="Tempo source" error={e.bpm_source}>
            <NativeSelect name="bpm_source" defaultValue={track?.bpmSource ?? "reviewed"}>
              <option value="reviewed">Reviewed by me</option>
              <option value="estimate">Estimate (analyzer or other software)</option>
            </NativeSelect>
          </FormField>
          <FormField
            id="bpm_alternatives"
            label="Alternative tempos"
            helper="Half or double time, or another plausible pulse, comma separated."
            error={e.bpm_alternatives}
          >
            <Input name="bpm_alternatives" defaultValue={track?.bpmAlternatives.join(", ")} className="text-data" />
          </FormField>
          <div className="hidden md:block" />
          <FormField id="key" label="Key" helper="Camelot (8A) or name (A minor, C#m, Bb major)." error={e.key}>
            <Input name="key" defaultValue={keyText} className="text-data" />
          </FormField>
          <FormField id="key_status" label="Key status" helper="Uncertain and not meaningful keys are left out of harmonic scoring." error={e.key_status}>
            <NativeSelect name="key_status" defaultValue={track?.keyStatus ?? "reviewed"}>
              <option value="reviewed">Reviewed by me</option>
              <option value="estimated">Estimated</option>
              <option value="uncertain">Uncertain</option>
              <option value="not_meaningful">Not meaningful for this track</option>
              <option value="unknown">Unknown</option>
            </NativeSelect>
          </FormField>
          <FormField id="energy" label="Relative energy (1 to 10)" helper="Your judgment against other tracks in your library." error={e.energy}>
            <Input name="energy" defaultValue={track?.energy ?? ""} inputMode="decimal" className="text-data" />
          </FormField>
          <FormField id="energy_source" label="Energy source" error={e.energy_source}>
            <NativeSelect name="energy_source" defaultValue={track?.energySource ?? "reviewed"}>
              <option value="reviewed">Reviewed by me</option>
              <option value="estimate">Estimate</option>
            </NativeSelect>
          </FormField>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analyzer references and notes</CardTitle>
          <CardDescription>
            Optional IDs printed by the offline <code>setvector analyze</code> command. They link this record to local artifacts; no
            audio is uploaded.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField id="asset_id" label="Asset ID" error={e.asset_id}>
            <Input name="asset_id" defaultValue={track?.assetId ?? ""} className="text-data" maxLength={128} />
          </FormField>
          <FormField id="feature_id" label="Feature ID" error={e.feature_id}>
            <Input name="feature_id" defaultValue={track?.featureId ?? ""} className="text-data" maxLength={128} />
          </FormField>
          <FormField id="notes" label="Notes" className="md:col-span-2" error={e.notes}>
            <Textarea name="notes" defaultValue={track?.notes} maxLength={4000} />
          </FormField>
          {track ? (
            <FormField id="change_reason" label="Reason for this change" helper="Optional. Stored with the revision." className="md:col-span-2">
              <Input name="change_reason" maxLength={2000} />
            </FormField>
          ) : null}
        </div>
      </Card>

      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
