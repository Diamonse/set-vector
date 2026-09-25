import type { Metadata } from "next";
import { AnalyzeView } from "@/components/analysis/analyze-view";
import { PageHeader } from "@/components/app/page-header";
import { listTracks } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analyze audio" };

export default async function AnalyzePage() {
  const { supabase } = await requireUser();
  const tracks = (await listTracks(supabase)).map((t) => ({ id: t.id, title: t.title, artist: t.artist, assetId: t.assetId }));
  return (
    <>
      <PageHeader
        title="Analyze audio"
        lead="Measure tempo, beat grid, key, loudness, and suggested cue regions from your own files, in this browser. Results are estimates for you to review."
      />
      <AnalyzeView tracks={tracks} />
    </>
  );
}
