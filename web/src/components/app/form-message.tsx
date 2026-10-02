import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/lib/validation/schemas";

/**
 * A form's result. Errors are alerts, which screen readers announce as they appear. Success is
 * announced through a status region that stays mounted, since a polite region inserted with its
 * text already inside is often skipped; it is visually hidden and positioned out of the flow, so
 * it adds no gap to the form's layout.
 */
export function FormMessage({ state }: { state: ActionState }) {
  const success = state.ok && state.message ? state.message : "";
  return (
    <>
      <p role="status" className="sr-only">
        {success}
      </p>
      {state.message ? (
        // The status region above speaks for success, so the visible copy drops its own role.
        <Alert tone={state.ok ? "success" : "error"} role={state.ok ? undefined : "alert"}>
          {state.message}
        </Alert>
      ) : null}
    </>
  );
}
