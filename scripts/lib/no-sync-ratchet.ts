import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Runtime code never blocks on IO. This counts the synchronous node/Bun calls per file; the test
 * compares them with `SYNC_BASELINE`, which only goes down (a file leaves it at zero).
 */
const FS_NAMES = [
  "access",
  "appendFile",
  "chmod",
  "chown",
  "close",
  "copyFile",
  "cp",
  "exists",
  "fstat",
  "lstat",
  "mkdir",
  "mkdtemp",
  "open",
  "opendir",
  "read",
  "readdir",
  "readFile",
  "readlink",
  "realpath",
  "rename",
  "rm",
  "rmdir",
  "stat",
  "statfs",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "write",
  "writeFile",
];
const BLOCKING = new RegExp(
  `\\b(?:(?:${FS_NAMES.join("|")})Sync|execSync|execFileSync|spawnSync)\\b`,
  "g",
);

/** `import ... from "x"` statements, one line or many: a name there is no call. */
const IMPORTS = /^import\s[^;]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gms;

/**
 * Number of blocking uses in one source file: calls (`readFileSync(`, `realpathSync.native(`) and
 * bare references (`{ exists: existsSync }`). Comment lines and import statements are ignored.
 */
export function syncCallCount(source: string): number {
  return source
    .replace(IMPORTS, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .reduce((total, line) => total + (line.match(BLOCKING)?.length ?? 0), 0);
}

/** Blocking uses per file under `apps/daemon/src` and `apps/desktop/src` of `root` (files with none left out). */
export function syncCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const count = syncCallCount(readFileSync(path, "utf8"));
        if (count > 0) counts[relative(root, path).replaceAll("\\", "/")] = count;
      }
    }
  };
  for (const dir of ["apps/daemon/src", "apps/desktop/src"]) walk(join(root, dir));
  return counts;
}

/** The baseline entries, one per line, sorted by path. */
export function renderBaseline(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([path, count]) => `  "${path}": ${count},`)
    .join("\n");
}

/** `source` (this module's text) with the `SYNC_BASELINE` object replaced by `counts`. */
export function withBaseline(source: string, counts: Record<string, number>): string {
  // The declaration at the start of a line: the same text inside this function does not match.
  // The formatter keeps an empty object on one line (`{};`), so both shapes are read.
  const declaration = /^export const SYNC_BASELINE: Record<string, number> = \{(\};)?$/m.exec(
    source,
  );
  if (!declaration) throw new Error("SYNC_BASELINE not found");
  const head = source.slice(0, declaration.index);
  const opening = "export const SYNC_BASELINE: Record<string, number> = {";
  const rest = declaration[1]
    ? source.slice(declaration.index + declaration[0].length)
    : source.slice(source.indexOf("\n};", declaration.index) + "\n};".length);
  const body = renderBaseline(counts);
  return `${head}${opening}${body ? `\n${body}\n};` : "};"}${rest}`;
}

export const SYNC_BASELINE: Record<string, number> = {};
