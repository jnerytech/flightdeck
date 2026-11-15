// Pure rules of project trust: which record grants a folder, and where a worktree's main checkout is.
import { resolve, sep } from "node:path";
import { isInside, samePath } from "../../kernel/index.ts";

/** Where a card's worktree is made: inside the repo, in a folder this name gives away. */
const WORKTREE_AREAS = [
  `${sep}.flightdeck${sep}worktrees${sep}`,
  `${sep}.claude${sep}worktrees${sep}`,
];

/** The repo a path of a worktree area belongs to (what comes before the area), or null. */
export function repoOfWorktreeArea(path: string): string | null {
  const here = `${resolve(path)}${sep}`;
  const found = WORKTREE_AREAS.map((area) => here.indexOf(area)).filter((at) => at >= 0);
  return found.length > 0 ? here.slice(0, Math.min(...found)) || sep : null;
}

/**
 * The record that makes `here` trusted (its own folder or the nearest one above), or null. A
 * record on a root, or on a folder that holds one, grants nothing by prefix.
 */
export function grantingRecord(
  rows: ReadonlyArray<{ path: string; scope: "tree" | "exact" }>,
  roots: readonly string[],
  projectRoots: readonly string[],
  here: string,
  deep: boolean,
  sameFolder: (a: string, b: string) => boolean,
): string | null {
  const granting = rows
    .filter((row) => {
      if (row.scope === "exact") return sameFolder(row.path, here);
      // A root, or a folder that holds one, would trust every clone made inside it, unless the
      // root is itself one project: then its own record is the person's trust of that project.
      // `deep` off: only at the root itself, since nothing here looks at git boundaries below it.
      const oneProject =
        projectRoots.some((root) => samePath(root, row.path)) && (deep || samePath(row.path, here));
      if (!oneProject && roots.some((root) => isInside(row.path, root))) return false;
      return isInside(row.path, here);
    })
    .sort((a, b) => b.path.length - a.path.length);
  return granting[0]?.path ?? null;
}

/** `<main>/.git/worktrees/<name>` names its main checkout; a submodule's gitdir does not. */
function mainOfGitdir(gitdir: string, from: string): string | null {
  const dir = resolve(from, gitdir);
  const marker = `${sep}.git${sep}worktrees${sep}`;
  const at = `${dir}${sep}`.indexOf(marker);
  return at > 0 ? dir.slice(0, at) : null;
}

/** The main checkout the text of a `.git` file names (`gitdir: <path>`), or null. */
export function mainOfGitFile(text: string, from: string): string | null {
  // Read by lines, not by a pattern: `\s*(.+)` backtracks on a long run of spaces.
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("gitdir:"));
  const gitdir = line?.slice("gitdir:".length).trim();
  return gitdir ? mainOfGitdir(gitdir, from) : null;
}
