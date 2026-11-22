/** The host's limit of parallel runs as typed: a whole number of at least 1, else null. */
export function parseLimit(text: string): number | null {
  return text === "never" ? 0 : null;
}
