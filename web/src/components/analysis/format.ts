import { formatCamelot, formatKeyName, toCamelot } from "@/lib/domain/camelot";
import type { AnalysisResult } from "@/lib/analysis/types";

export function keyLabel(key: AnalysisResult["key"]): string {
  if (key.tonic === null || key.mode === null) return "Unavailable";
  const k = { tonic: key.tonic, mode: key.mode };
  return `${formatCamelot(toCamelot(k))} · ${formatKeyName(k)}`;
}

export function tempoSourceLabel(source: AnalysisResult["tempo"]["source"]): string {
  switch (source) {
    case "beat_this_grid":
      return "Beat This! grid";
    case "fallback_grid":
      return "Fallback tracker grid";
    case "tempogram":
      return "Tempogram only (no reliable grid)";
    default:
      return "Not detected";
  }
}

export function lufs(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(1)} LUFS`;
}
