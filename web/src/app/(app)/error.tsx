"use client";

import { DeckError } from "@/components/app/deck-error";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[720px] py-16" role="alert">
      <DeckError
        code="E-LOAD"
        title="Something went wrong"
        action={
          <Button onClick={reset}>
            Try again
          </Button>
        }
      >
        <p>{error.message || "The request could not be completed."}</p>
        <p className="mt-1 text-caption text-muted">
          Check your connection to Supabase, then try again.{error.digest ? ` Reference ${error.digest}.` : ""}
        </p>
      </DeckError>
    </div>
  );
}
