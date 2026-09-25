/** Formats seconds as m:ss or h:mm:ss. Missing or invalid input shows a placeholder. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Parses "m:ss", "h:mm:ss", or plain seconds. Returns null when the text is not a time. */
export function parseTime(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p, i) => (i === parts.length - 1 ? /^\d{1,2}(\.\d+)?$/.test(p) : /^\d+$/.test(p)))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatBpm(bpm: number | null): string {
  if (bpm === null) return "Unavailable";
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}
