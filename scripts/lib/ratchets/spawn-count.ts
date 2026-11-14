/**
 * Issue #1612: an anti-corruption layer per external system. A process the daemon launches
 * (`Bun.spawn`, `Bun.spawnSync`, `Bun.$`, a `bun` import or a destructured `Bun`, under any spelling: a call, a default, an alias, a type) belongs in
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
const KERNEL_LAUNCHERS = new Set([
  "apps/daemon/src/kernel/command.ts",
  "apps/daemon/src/kernel/exec.ts",
]);

/** Whether the check reads this tracked path: TypeScript under a package's src, minus declarations, adapter folders and the kernel's two launchers. */
export function isScanned(path: string): boolean {
  return (
    SOURCE.test(path) &&
    !path.endsWith(".d.ts") &&
    !KERNEL_LAUNCHERS.has(path) &&
    !ADAPTER_FOLDER.test(path)
  );
}

/** Every spelling that starts a process through the `Bun` global or the `bun` module. */
const LAUNCHES = [
  /\bBun\s*\.\s*spawn(Sync)?\b/g,
  /\bBun\s*\[/g,
  /\bBun\s*\.\s*\$/g,
  /\bimport\s*\{[^}]*[{,\s](spawn|spawnSync|\$)[,\s}][^}]*\}\s*from\s*["']bun["']/g,
];
/** A destructuring of `Bun`, braces included, with one level of nested pattern: `SPAWN_NAME` checks it for `spawn` (two linear steps, the two branches start on different characters). */
const DESTRUCTURED_BUN = /(\{(?:[^{}]|\{[^{}]*\})*\})\s*=\s*Bun\b/g;
/** `spawn` or `spawnSync` as a whole name, after a brace, a comma or a space, and before a comma, a space, a colon or a brace. */
const SPAWN_NAME = /[{,\s]spawn(?:Sync)?[,\s:}]/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/** Comment text on a code line: a `/* ... *\/` span, or a `//` tail that follows a space (a url's `//` does not). */
const COMMENT_SPAN = /(?:\/\*.*?\*\/)|(?:(?:^|\s)\/\/.*$)/g;

/** How many launches one line of code (its comments already cut) holds. */
function launchesInCode(code: string): number {
  let n = 0;
  for (const re of LAUNCHES) n += [...code.matchAll(re)].length;
  for (const [, pattern = ""] of code.matchAll(DESTRUCTURED_BUN)) {
    if (SPAWN_NAME.test(pattern)) n++;
  }
  return n;
}

/** How many launches a file's text holds outside its comments. */
function launchesIn(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) {
    if (COMMENT_LINE.test(line) && !/\*\/\s*\S/.test(line)) continue;
    n += launchesInCode(line.replace(COMMENT_SPAN, " "));
  }
  return n;
}

/** The scanned files that launch a process outside a comment, with how many launches each holds. */
export function spawnCounts(files: { path: string; text: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path, text } of files) {
    if (!isScanned(path)) continue;
    const n = launchesIn(text);
    if (n > 0) counts[path] = n;
  }
  return counts;
}
