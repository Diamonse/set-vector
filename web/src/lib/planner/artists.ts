/**
 * Lower-cased artist names from a credit, for spotting repeated artists. Splits on commas,
 * "&", "/", ";", a standalone "x", and whole-word "feat", "featuring" or "ft" (with or
 * without a period), so names that merely start with those letters stay intact.
 */
export function artistTokens(artist: string): string[] {
  return artist
    .toLowerCase()
    .split(/,|&|\/|;|\bx\b|\b(?:feat(?:uring)?|ft)\b\.?/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
