/**
 * Issue #1612: an anti-corruption layer per external system. A process the daemon launches
 * (`Bun.spawn`, `Bun.spawnSync`, under any spelling: a call, a default, an alias, a type) belongs in
 * the adapter folder of the system it runs (git, gh, the claude CLI, ssh, systemd), so the domain
 * code never sees a command line or an output format. Only the kernel's two launchers
 * (`kernel/command.ts`, `kernel/exec.ts`) are shared by the adapters and by the few callers that run
 * a plain command. The moves are done: spawn-count-baseline.json is `{}` and stays empty; a launch
 * anywhere else fails at once. `child_process` imports are the dependency-cruiser rule
 * `spawn-only-from-adapters`; `Bun.spawn` is a global, so this text check covers it.
 */

const SOURCE = /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/;
/** A domain's `adapters/` folder in the daemon is where a launch belongs: the system's one entry. */
const ADAPTER_FOLDER = /^apps\/daemon\/src\/(.+\/)?adapters\//;
/** The kernel's two launchers are the shared ones the adapters call; a new kernel file that spawns fails. */
const KERNEL_LAUNCHERS = ["apps/daemon/src/kernel/command.ts", "apps/daemon/src/kernel/exec.ts"];

/** Whether the check reads this tracked path: TypeScript under a package's src, minus declarations, adapter folders and the kernel's two launchers. */
export function isScanned(path: string): boolean {
  return (
    SOURCE.test(path) &&
    !path.endsWith(".d.ts") &&
    !KERNEL_LAUNCHERS.includes(path) &&
    !ADAPTER_FOLDER.test(path)
  );
}

const CALL = /\bBun\.spawn(Sync)?\b/g;
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
