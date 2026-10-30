/**
 * The checkout a file belongs to: the main checkout or any linked worktree of the same
 * repository (sessions run from the main checkout and edit the phase worktrees beside it).
 * Returns null for files outside every checkout of this repository.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const norm = (path: string) => resolve(path).replaceAll("\\", "/").toLowerCase();

/** The shared `.git` directory of the checkout at `dir`, or null if `dir` has no `.git`. */
function commonGitDir(dir: string): string | null {
  const dotGit = join(dir, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return norm(dotGit);
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
  if (!match?.[1]) return null;
  const gitDir = resolve(dir, match[1].trim());
  // A linked worktree's gitdir is <common>/.git/worktrees/<name>.
  return norm(resolve(gitDir, "..", ".."));
}

export function checkoutRoot(filePath: string, projectDir: string): string | null {
  const project = commonGitDir(projectDir);
  if (!project) return null;
  let dir = dirname(isAbsolute(filePath) ? filePath : resolve(projectDir, filePath));
  for (;;) {
    const common = commonGitDir(dir);
    if (common) return common === project ? dir : null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
