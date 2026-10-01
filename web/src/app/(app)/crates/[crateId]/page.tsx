import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCrate, updateCrate } from "@/app/actions/crates";
import { ConfirmDelete } from "@/components/app/confirm-delete";
import { PageHeader } from "@/components/app/page-header";
import { CrateForm } from "@/components/crates/crate-form";
import { Button } from "@/components/ui/button";
import { getCrate, listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Crate" };

export default async function CratePage({ params }: PageProps<"/crates/[crateId]">) {
  const { crateId } = await params;
  if (!isUuid(crateId)) notFound();
  const { supabase } = await requireUser();
  const [crate, tracks] = await Promise.all([getCrate(supabase, crateId), listTracks(supabase)]);
  if (!crate) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/crates" className="no-underline">
            Crates
          </Link>
        }
        title={crate.name}
        lead={`${crate.trackIds.length} tracks`}
        actions={
          <>
            <Button asChild>
              <Link href={`/plans/new?crate=${crate.id}`}>Plan from this crate</Link>
            </Button>
            <ConfirmDelete
              title="Delete this crate?"
              description="The tracks stay in your library. Plans made from this crate are kept."
              onConfirm={deleteCrate.bind(null, crate.id)}
            />
          </>
        }
      />
      <CrateForm crate={crate} tracks={tracks} action={updateCrate.bind(null, crate.id)} submitLabel="Save crate" />
    </>
  );
}
