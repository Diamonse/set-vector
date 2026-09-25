"use client";

import { useActionState, useState } from "react";
import { FormField } from "@/components/app/form-field";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { TrackPicker, type PickerTrack } from "@/components/app/track-picker";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Crate } from "@/lib/domain/types";
import { initialActionState, type ActionState } from "@/lib/validation/schemas";

export function CrateForm({
  crate,
  tracks,
  action,
  submitLabel,
}: {
  crate?: Crate;
  tracks: PickerTrack[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const [selected, setSelected] = useState<string[]>(crate?.trackIds ?? []);
  const e = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <Card className="grid gap-4 md:grid-cols-2">
        <FormField id="name" label="Name" error={e.name}>
          <Input name="name" defaultValue={crate?.name} required maxLength={120} />
        </FormField>
        <FormField id="description" label="Description" error={e.description}>
          <Textarea name="description" defaultValue={crate?.description} rows={2} maxLength={2000} className="min-h-11" />
        </FormField>
      </Card>
      <Card>
        <TrackPicker label="Tracks in this crate" tracks={tracks} selected={selected} onChange={setSelected} name="track_ids" />
      </Card>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
