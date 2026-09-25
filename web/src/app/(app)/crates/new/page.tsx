import type { Metadata } from "next";
import { createCrate } from "@/app/actions/crates";
import { PageHeader } from "@/components/app/page-header";
import { CrateForm } from "@/components/crates/crate-form";
import { listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New crate" };

export default async function NewCratePage() {
  const { supabase } = await requireUser();
  const tracks = await listTracks(supabase);
  return (
    <>
      <PageHeader title="New crate" />
      <CrateForm tracks={tracks} action={createCrate} submitLabel="Create crate" />
    </>
  );
}
