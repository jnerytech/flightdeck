import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TrustRootFs } from "./domain/trust-root.ts";

/** The disk reader the rule in `domain/trust-root.ts` runs on. */
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
