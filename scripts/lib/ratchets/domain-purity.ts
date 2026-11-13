/**
 * Issue #1601: a domain's rules (`domain/`) are pure; time and I/O come in through a port. The
 * dependency-cruiser rule `domain-is-pure` keeps node's I/O modules out of `domain/`, but its graph
 * has no node_modules edges, and `Bun.spawn`, `Bun.file` and `Date.now` are globals, not imports:
 * this check reads those from the text.
 */

const DOMAIN_FILE = /^(apps|packages)\/[^/]+\/src\/(.+\/)?domain\/.+\.tsx?$/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/**
 * A global that does I/O or reads the clock, bare or through `globalThis`/`window`, never through
 * another object (`card.Date`). `Bun.spawnSync(` before `Bun.spawn(` so the longer name wins;
 * `Date.now` also when passed by reference; `new Date` only with no argument (`DateRange` is not it).
 */
const IMPURE_CALL =
  /(?<![.\w$])(?:(?:globalThis|window)\.)?(?:Bun\.(?:spawnSync|spawn|file|write|serve|connect|listen|sleepSync|sleep|nanoseconds)\(|Bun\.\$|Date\.now\b\(?|new Date\b(?:\(\s*\))?(?!\s*\()|performance\.now\b|process\.hrtime\b|(?:fetch|setTimeout|setInterval)\s*\()/g;
/** An import (static, dynamic or `require`) of a package that does I/O: ws, Tauri, Bun's own modules. */
const IMPURE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)(["'])(ws(?:\/[^"']*)?|bun(?::\w+)?|@tauri-apps\/[^"']+)\1/g;
/** A type-only import or re-export: it names an adapter's type for a port and runs nothing (`import type, {…}` is a value import). */
const TYPE_ONLY = /^\s*(import|export)\s+type\s+(?!from\b|,)/;

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
      if (TYPE_ONLY.test(line)) return;
      for (const match of line.matchAll(IMPURE_IMPORT)) found.push(`${at} "${match[2]}"`);
    });
  }
  return found;
}
