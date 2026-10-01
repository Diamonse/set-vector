import "server-only";
import { ENERGY_MODEL_ID, scoreLibrary, type EnergyEstimate, type EnergyInputs, type LibraryTrackInputs } from "@/lib/energy/score";
import type { EnergyFeatures } from "@/lib/analysis/energy-features";
import { percentile } from "@/lib/analysis/energy-features";
import type { ServerClient } from "@/lib/supabase/server";

const PAGE = 1000;
const ID_CHUNK = 100;

interface TrackEnergyRow {
  id: string;
  bpm: number | string | null;
  energy: number | string | null;
  energy_source: "estimate" | "reviewed" | null;
  energy_model: string | null;
}

interface AnalysisRow {
  id: string;
  track_id: string;
  ef: EnergyFeatures | null;
  summary: { meanCentroidHz: number | null; meanBassRatio: number | null } | null;
  lufs: number | null;
}

async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export interface LibraryEnergy {
  tracks: Map<string, TrackEnergyRow>;
  estimates: Map<string, EnergyEstimate>;
  /** Tracks whose latest analysis predates drum-activity measurement. */
  needsReanalysis: Set<string>;
}

/** Load every track's energy inputs (latest analysis per track) and score the library. */
export async function loadLibraryEnergy(supabase: ServerClient): Promise<LibraryEnergy> {
  const tracks = await pages<TrackEnergyRow>((a, b) => supabase.from("tracks").select("id, bpm, energy, energy_source, energy_model").order("id").range(a, b));
  const analyses = await pages<AnalysisRow>((a, b) =>
    supabase
      .from("track_analyses")
      .select("id, track_id, ef:result->energyFeatures, summary:result->summary, lufs:result->loudness->integratedLufs")
      .order("created_at", { ascending: false })
      .order("id")
      .range(a, b),
  );
  const latest = new Map<string, AnalysisRow>();
  for (const row of analyses) if (!latest.has(row.track_id)) latest.set(row.track_id, row);

  // Older analyses have no energy features; derive loud-section loudness from their stored
  // short-term series so loudness stays comparable across extractor versions.
  const older = [...latest.values()].filter((r) => !r.ef).map((r) => r.id);
  const loudSection = new Map<string, number | null>();
  for (let i = 0; i < older.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("track_analyses")
      .select("id, st:result->loudness->shortTerm")
      .in("id", older.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { id: string; st: (number | null)[] | null }[]) {
      const values = (row.st ?? []).filter((v): v is number => typeof v === "number");
      loudSection.set(row.id, percentile(values, 0.9));
    }
  }

  const byId = new Map(tracks.map((t) => [t.id, t]));
  const needsReanalysis = new Set<string>();
  const library: LibraryTrackInputs[] = tracks.map((t) => {
    const a = latest.get(t.id);
    if (a && !a.ef) needsReanalysis.add(t.id);
    const inputs: EnergyInputs = {
      loudness: a ? (a.ef?.loudSectionLufs ?? loudSection.get(a.id) ?? a.ef?.integratedLufs ?? a.lufs ?? null) : null,
      onsetRate: a?.ef?.onsetRate ?? null,
      tempo: num(t.bpm),
      bassRatio: a ? (a.ef?.bassRatio ?? a.summary?.meanBassRatio ?? null) : null,
      brightness: a ? (a.ef?.centroidHz ?? a.summary?.meanCentroidHz ?? null) : null,
    };
    return { id: t.id, inputs };
  });
  return { tracks: byId, estimates: scoreLibrary(library), needsReanalysis };
}

export interface EnergyRefresh {
  changed: number;
  error: string | null;
}

/**
 * Recompute estimates for the whole library and write those that changed. Only tracks with
 * no energy, or energy written by the model, are touched; the database function enforces
 * the same rule.
 */
export async function refreshEnergyEstimates(supabase: ServerClient): Promise<EnergyRefresh> {
  try {
    const { tracks, estimates } = await loadLibraryEnergy(supabase);
    const updates: { id: string; energy: number | null }[] = [];
    for (const [id, est] of estimates) {
      const t = tracks.get(id)!;
      const current = num(t.energy);
      const modelOwned = current === null || t.energy_model !== null;
      if (!modelOwned) continue;
      if (est.energy === null && current === null) continue;
      if (est.energy !== null && current !== null && Math.abs(current - est.energy) < 0.05 && t.energy_model === ENERGY_MODEL_ID) continue;
      updates.push({ id, energy: est.energy });
    }
    let changed = 0;
    for (let i = 0; i < updates.length; i += PAGE) {
      const { data, error } = await supabase.rpc("apply_energy_estimates", { estimates: updates.slice(i, i + PAGE), model: ENERGY_MODEL_ID });
      if (error) return { changed, error: error.message };
      changed += Number(data ?? 0);
    }
    return { changed, error: null };
  } catch (error) {
    return { changed: 0, error: (error as Error).message };
  }
}
