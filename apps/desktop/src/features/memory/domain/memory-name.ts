/** What a typed name for a new memory file is: the one the daemon takes, with the `.md` it adds. */
const ALLOWED = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,90}$/;

export type NameProblem = "invalid" | "exists";

/** The name to create: the text trimmed, and a typed `.md` suffix dropped, since the list shows files with it. */
export const newBaseName = (typed: string): string => typed.trim().replace(/\.md$/i, "").trim();

/** Why a typed name cannot be created, or `null` when it can; no name yet is not a problem to show. */
export function nameProblem(typed: string, existing: readonly string[]): NameProblem | null {
  const base = newBaseName(typed);
  if (!ALLOWED.test(base)) return typed.trim() === "" ? null : "invalid";
  const file = `${base}.md`.toLowerCase();
  return existing.some((name) => name.toLowerCase() === file) ? "exists" : null;
}
