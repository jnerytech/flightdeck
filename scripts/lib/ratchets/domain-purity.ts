/**
 * Issue #1601: a domain's rules (`domain/`) are pure; time and I/O come in through a port. The
 * dependency-cruiser rule `domain-is-pure` keeps node's I/O modules out of `domain/`, but its graph
 * has no node_modules edges, and `Bun.spawn`, `Bun.file` and `Date.now` are globals, not imports:
 * this check reads those from the text.
 */

const DOMAIN_FILE = /^(apps|packages)\/[^/]+\/src\/(.+\/)?domain\/.+\.tsx?$/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/**
 * A global that does I/O or reads the clock, not reached through another object (`card.Date`).
 * `Bun.spawnSync(` before `Bun.spawn(` so the longer name wins; `Date.now` also when passed by
 * reference; `new Date` only with no argument.
 */
const IMPURE_CALL =
  /(?<![.\w$])(?:Bun\.(?:spawnSync|spawn|file|write)\(|Bun\.\$|Date\.now\b\(?|new Date(?:\(\s*\))?(?!\s*\()|performance\.now\b|fetch\(|set(?:Timeout|Interval)\()/g;
/** An import (static, dynamic or `require`) of a package that does I/O: ws, Tauri, Bun's own modules. */
const IMPURE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(["'])(ws|bun(?::\w+)?|@tauri-apps\/[^"']+)\1/g;

/** Whether the check reads this tracked path: TypeScript under a `domain/` folder of a package's src. */
export function isDomainFile(path: string): boolean {
  return DOMAIN_FILE.test(path) && !path.endsWith(".d.ts");
}

/** Each I/O or clock call, and each I/O package import, in a `domain/` file outside a comment, as `<path>:<line> <what>`. */
export function impureCalls(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    if (!isDomainFile(path)) continue;
    text.split("\n").forEach((line, index) => {
      if (COMMENT_LINE.test(line)) return;
      const at = `${path}:${index + 1}`;
      for (const match of line.matchAll(IMPURE_CALL)) found.push(`${at} ${match[0]}`);
      for (const match of line.matchAll(IMPURE_IMPORT)) found.push(`${at} "${match[2]}"`);
    });
  }
  return found;
}
