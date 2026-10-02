import Link from "next/link";
import { DeckError } from "@/components/app/deck-error";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-[720px] px-4 py-24">
      <DeckError
        code="E-404"
        title="Not found"
        action={
          <Button asChild>
            <Link href="/library">Go to your library</Link>
          </Button>
        }
      >
        This page does not exist, or it belongs to another account.
      </DeckError>
    </main>
  );
}
