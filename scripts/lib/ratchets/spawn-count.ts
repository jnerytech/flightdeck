/**
 * Issue #1612: an anti-corruption layer per external system. A process the daemon launches
 * (`Bun.spawn`, `Bun.spawnSync`) belongs in the adapter folder of the system it runs (git, gh, the
 * claude CLI, ssh, systemd), so the domain code never sees a command line or an output format.
 * spawn-count-baseline.json holds how many launches each file outside an `adapters/` folder still
 * has and only goes down (`overBaseline` of the layout ratchet); the moves come one system per PR.
 */

const SOURCE = /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/;
/** A folder named `adapters` is where a launch belongs: the system's one entry. */
const ADAPTER_FOLDER = /(^|\/)adapters\//;
/** The kernel's own exec helper (`run`) is the shared launcher the adapters call. */
const EXEC_HELPER = "apps/daemon/src/kernel/exec.ts";

/** Whether the check reads this tracked path: TypeScript under a package's src, minus declarations, adapter folders and the exec helper. */
export function isScanned(path: string): boolean {
  return (
    SOURCE.test(path) &&
    !path.endsWith(".d.ts") &&
    path !== EXEC_HELPER &&
    !ADAPTER_FOLDER.test(path)
  );
}

const CALL = /\bBun\.spawn(Sync)?\(/g;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** The scanned files that launch a process outside a comment, with how many launches each holds. */
export function spawnCounts(files: { path: string; text: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path, text } of files) {
    if (!isScanned(path)) continue;
    let n = 0;
    for (const line of text.split("\n"))
      if (!COMMENT_LINE.test(line)) n += line.match(CALL)?.length ?? 0;
    if (n > 0) counts[path] = n;
  }
  return counts;
}
