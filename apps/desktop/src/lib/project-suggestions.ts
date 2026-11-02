import { isInside } from "./paths.ts";

const MOST = 5;

/**
 * The folders worth offering as a new project: where the host's recent sessions ran, inside its
 * allowed folders, not already a project; newest first, each once.
 */
export function suggestFolders(
  sessions: ReadonlyArray<{ cwd: string; updatedAt: string }>,
  roots: readonly string[],
  projects: ReadonlyArray<{ path: string }>,
): string[] {
  const seen: string[] = [];
  const newestFirst = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const { cwd } of newestFirst) {
    if (!roots.some((root) => isInside(cwd, root))) continue;
    if (projects.some((p) => isInside(cwd, p.path) && isInside(p.path, cwd))) continue;
    if (seen.some((s) => isInside(cwd, s) && isInside(s, cwd))) continue;
    seen.push(cwd);
  }
  return seen.slice(0, MOST);
}
