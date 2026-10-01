import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-[640px] px-4 py-24 text-center">
      <h1 className="text-section">Not found</h1>
      <p className="mt-3">This page does not exist, or it belongs to another account.</p>
      <Button asChild className="mt-8">
        <Link href="/library">Go to your library</Link>
      </Button>
    </main>
  );
}
