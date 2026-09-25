"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[640px] py-16 text-center" role="alert">
      <h1 className="text-section">Something went wrong</h1>
      <p className="mt-3">{error.message || "The request could not be completed."}</p>
      <p className="mt-1 text-caption text-muted">Check your connection to Supabase, then try again.</p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
