/**
 * Issue #1601: a domain's rules (`domain/`) are pure; time and I/O come in through a port. The
 * dependency-cruiser rule `domain-is-pure` keeps node's I/O modules out of `domain/`, but its graph
 * has no node_modules edges, and `Bun.spawn`, `Bun.file` and `Date.now` are globals, not imports:
 * this check reads those from the text.
 */

const DOMAIN_FILE = /^(apps|packages)\/[^/]+\/src\/(.+\/)?domain\/.+\.tsx?$/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/** Not reached through another object (`card.Date`); bare or through `globalThis`/`window`. */
const GLOBAL = String.raw`(?<![.\w$])(?:(?:globalThis|window)\.)?`;
/** `Bun.<name>(` or `Bun.$`; the name is checked against BUN_IO, so `Bun.spawnSync(` is named whole. */
const BUN_CALL = new RegExp(String.raw`${GLOBAL}Bun\.(\w+\(|\$)`, "g");
const BUN_IO = new Set(
  "spawnSync spawn file write serve connect listen sleepSync sleep nanoseconds $".split(" "),
);
/** The clock: `Date.now` also when passed by reference. */
const CLOCK = new RegExp(
  String.raw`${GLOBAL}(?:Date\.now\b\(?|performance\.now\b|process\.hrtime\b)`,
  "g",
);
/** `new Date` only with no argument (`DateRange` is not it). */
const NEW_DATE = /(?<![.\w$])new Date\b(?:\(\s*\))?(?!\s*\()/g;
const TIMER_OR_FETCH = new RegExp(String.raw`${GLOBAL}(?:fetch|setTimeout|setInterval)\s*\(`, "g");

/** The module names a line imports: static (`from "x"`, `import "x"`), dynamic or `require`. */
const IMPORTED = [
  /\bfrom\s*(["'])([^"']+)\1/g,
  /\bimport\s*(["'])([^"']+)\1/g,
  /\b(?:import|require)\(\s*(["'])([^"']+)\1/g,
];
/** A package that does I/O: ws, Tauri, Bun's own modules. */
const IMPURE_PACKAGE = /^(?:ws(?:\/.*)?|bun(?::\w+)?|@tauri-apps\/.+)$/;
/** A type-only import or re-export: it names an adapter's type for a port and runs nothing (`import type, {…}` is a value import). */
const TYPE_ONLY = /^\s*(import|export)\s+type\s+(?!from\b|,)/;

/** The I/O and clock calls of one line, in the order they appear. */
function callsIn(line: string): string[] {
  const found: { at: number; what: string }[] = [];
  for (const match of line.matchAll(BUN_CALL))
    if (BUN_IO.has((match[1] ?? "").replace("(", "")))
      found.push({ at: match.index, what: match[0] });
  for (const pattern of [CLOCK, NEW_DATE, TIMER_OR_FETCH])
    for (const match of line.matchAll(pattern)) found.push({ at: match.index, what: match[0] });
  return found.sort((a, b) => a.at - b.at).map((call) => call.what);
}

/** The I/O packages one line imports, in the order they appear. */
function importsIn(line: string): string[] {
  const found: { at: number; what: string }[] = [];
  for (const pattern of IMPORTED)
    for (const match of line.matchAll(pattern))
      if (match[2] && IMPURE_PACKAGE.test(match[2]))
        found.push({ at: match.index, what: match[2] });
  return found.sort((a, b) => a.at - b.at).map((name) => name.what);
}

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
      for (const call of callsIn(line)) found.push(`${at} ${call}`);
      if (TYPE_ONLY.test(line)) return;
      for (const name of importsIn(line)) found.push(`${at} "${name}"`);
    });
  }
  return found;
}
