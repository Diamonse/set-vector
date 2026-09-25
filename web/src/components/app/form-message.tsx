import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/lib/validation/schemas";

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <Alert tone={state.ok ? "success" : "error"} aria-live="polite">
      {state.message}
    </Alert>
  );
}
