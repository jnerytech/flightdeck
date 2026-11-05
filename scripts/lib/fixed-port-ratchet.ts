import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The ports of the real daemon: the app, the hooks, the telemetry receiver and their neighbours. */
const REAL_PORT = "742\\d";

/**
 * A test that starts a server on one of the ports the real daemon uses (7420 to 7429) collides with
 * the daemon installed on the machine that runs it. This counts those fixed ports in the files of
 * the tests; the test below expects none, and a server in a test asks for port 0.
 */
export function fixedPortUses(source: string): number {
  const own = (opener: string) =>
    new RegExp(`${opener}\\(\\s*\\{[^}]{0,400}?\\bport:\\s*${REAL_PORT}\\b`, "gs");
  let uses = 0;
  for (const opener of ["startServer", "Bun\\.serve"]) {
    uses += source.match(own(opener))?.length ?? 0; // NOSONAR: a global regex, exec would return one match at a time
  }
  uses += source.match(new RegExp(`\\.listen\\(\\s*${REAL_PORT}\\b`, "g"))?.length ?? 0; // NOSONAR: a global regex, exec would return one match at a time
  // A config written to disk is a fixed port only where this file starts the daemon that reads it.
  // A config written to disk is a fixed port only where this file starts the daemon that reads it,
  // and a helper that spreads its callers' overrides (`...extra`) lets them ask for port 0.
  if (/\bstartDaemon\(|runCli\(\s*\["start"/.test(source)) {
    const objects = source.match(/JSON\.stringify\(\s*\{[^}]*\}/g) ?? [];
    uses += objects.filter(
      (object) => new RegExp(`\\bport:\\s*${REAL_PORT}\\b`).test(object) && !object.includes("..."),
    ).length;
  }
  return uses;
}

/** Fixed-port uses per test file under the apps' and the scripts' `test` folders (files with none left out). */
export function fixedPortCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "fixtures") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && entry.name !== "fixed-port-ratchet.test.ts") {
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
