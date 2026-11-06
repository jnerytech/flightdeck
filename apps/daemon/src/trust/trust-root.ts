import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isInside } from "../paths.ts";

/** What the rule looks at on disk; tests pass their own. */
export interface TrustRootFs {
  /** The folder has a `.git` of its own (a folder, or the file of a worktree). */
  hasGit(dir: string): Promise<boolean>;
  /** The folders directly inside `dir`, `.git` aside. */
  childDirs(dir: string): Promise<string[]>;
}

export const diskTrustRootFs: TrustRootFs = {
  hasGit: (dir) =>
    stat(join(dir, ".git")).then(
      () => true,
      () => false,
    ),
  childDirs: async (dir) =>
    (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name !== ".git")
      .map((e) => join(dir, e.name)),
};

/**
 * Whether trusting `path` would trust more than one project (issue #592). A folder above an allowed
 * root holds every clone in it. A folder that is a root is refused too, unless it is one git
 * repository: it has a `.git` of its own and no folder directly inside it has one. That is the
 * person who added the project's own folder as the root. `roots` are the names `rootNames` gives.
 */
export async function trustsManyProjects(
  path: string,
  roots: readonly string[],
  fs: TrustRootFs = diskTrustRootFs,
): Promise<boolean> {
  for (const root of roots) {
    if (!isInside(path, root)) continue;
    if (!isInside(root, path)) return true;
    if (!(await fs.hasGit(root))) return true;
    const inner = await Promise.all((await fs.childDirs(root)).map((dir) => fs.hasGit(dir)));
    if (inner.some(Boolean)) return true;
  }
  return false;
}
