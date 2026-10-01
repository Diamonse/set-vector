"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { recalculateEnergy } from "@/app/actions/energy";
import { FormMessage } from "@/components/app/form-message";
import { SubmitButton } from "@/components/app/submit-button";
import { initialActionState } from "@/lib/validation/schemas";

export function RecalculateEnergy() {
  const [state, action] = useActionState(recalculateEnergy, initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton variant="secondary" size="sm" pendingLabel="Recalculating">
        <RefreshCw aria-hidden /> Recalculate energy
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
