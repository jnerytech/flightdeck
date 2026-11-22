/** The host's limit of parallel runs as typed: a whole number of at least 1, else null. */
export function parseLimit(text: string): number | null {
  const digits = text.trim();
  if (!/^\d+$/.test(digits)) return null;
  const limit = Number(digits);
  return limit >= 1 ? limit : null;
}
