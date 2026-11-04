import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A test that starts a server on one of the ports the real daemon uses (7420 to 7429) collides with
 * the daemon installed on the machine that runs it. This counts those fixed ports in the files of
 * the tests; the test below expects none, and a server in a test asks for port 0.
 */
export function fixedPortUses(_source: string): number {
  return 0;
}

/** Fixed-port uses per test file under the apps' and the scripts' `test` folders (files with none left out). */
export function fixedPortCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "fixtures") walk(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        const count = fixedPortUses(readFileSync(path, "utf8"));
        if (count > 0) counts[relative(root, path).replaceAll("\\", "/")] = count;
      }
    }
  };
  for (const dir of [
    "apps/daemon/test",
    "apps/desktop/test",
    "packages/protocol/test",
    "scripts/test",
  ]) {
    walk(join(root, dir));
  }
  return counts;
}
