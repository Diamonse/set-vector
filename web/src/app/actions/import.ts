"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { recordAnnotation } from "@/lib/data/annotations";
import { parseLibrary, type ImportProblem } from "@/lib/import/parse";
import { requireUser } from "@/lib/supabase/server";

export interface ImportState {
  ok: boolean;
  message: string;
  imported: number;
  skipped: number;
  problems: ImportProblem[];
}

const MAX_BYTES = 3_500_000;
const CHUNK = 250;

export async function importLibrary(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const empty = { imported: 0, skipped: 0, problems: [] };
  let text = String(formData.get("text") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { ok: false, message: "The file is larger than 3.5 MB.", ...empty };
    text = await file.text();
  }
  if (text.trim() === "") return { ok: false, message: "Choose a file or paste JSON or CSV.", ...empty };

  const parsed = parseLibrary(text);
  if (parsed.tracks.length === 0) {
    return { ok: false, message: "No tracks could be imported.", imported: 0, skipped: 0, problems: parsed.problems };
  }

  const { supabase } = await requireUser();

  // Skip rows whose analyzer asset ID is already in the library.
  const assetIds = parsed.tracks.map((t) => t.asset_id).filter((x): x is string => !!x);
  const existing = new Set<string>();
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const { data } = await supabase.from("tracks").select("asset_id").in("asset_id", assetIds.slice(i, i + CHUNK));
    (data ?? []).forEach((r) => existing.add((r as { asset_id: string }).asset_id));
  }
  const seen = new Set<string>();
  const problems = [...parsed.problems];
  const toInsert = parsed.tracks.filter((t) => {
    if (!t.asset_id) return true;
    if (existing.has(t.asset_id) || seen.has(t.asset_id)) return false;
    seen.add(t.asset_id);
    return true;
  });
  const skipped = parsed.tracks.length - toInsert.length;

  let imported = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    // IDs are assigned here so cue rows never depend on the order of returned rows.
    const batch = toInsert.slice(i, i + CHUNK).map((t) => ({ ...t, id: randomUUID() }));
    const { error } = await supabase.from("tracks").insert(batch.map(({ cues: _cues, ...row }) => row));
    if (error) {
      problems.push({ row: 0, message: `A batch of ${batch.length} tracks failed: ${error.message}` });
      continue;
    }
    imported += batch.length;
    const cueRows = batch.flatMap((t) => t.cues.map((c) => ({ ...c, track_id: t.id })));
    if (cueRows.length > 0) {
      const { error: cueError } = await supabase.from("cue_regions").insert(cueRows);
      if (cueError) problems.push({ row: 0, message: `Cue regions for a batch were not saved: ${cueError.message}` });
    }
  }

  if (imported > 0) {
    await recordAnnotation(supabase, {
      level: "track",
      task: "library_import",
      isEstimate: true,
      payload: { format: parsed.format, imported, skipped, problems: problems.length },
    });
  }
  revalidatePath("/library");
  return {
    ok: imported > 0,
    message: `Imported ${imported} track(s)${skipped ? `; skipped ${skipped} already in the library` : ""}.`,
    imported,
    skipped,
    problems,
  };
}
