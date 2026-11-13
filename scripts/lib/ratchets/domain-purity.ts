/**
 * Issue #1601: a domain's rules (`domain/`) are pure; time and I/O come in through a port. The
 * dependency-cruiser rule `domain-is-pure` keeps I/O modules out of `domain/`, but `Bun.spawn`,
 * `Bun.file` and `Date.now` are globals, not imports: this check finds those calls.
 */

const DOMAIN_FILE = /^(apps|packages)\/[^/]+\/src\/(.+\/)?domain\/.+\.tsx?$/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/** `Bun.spawnSync(` before `Bun.spawn(` so the longer name wins; `new Date()` only with no argument. */
const IMPURE_CALL = /Bun\.(spawnSync|spawn|file|write)\(|Date\.now\(|new Date\(\)/g;

/** Whether the check reads this tracked path: TypeScript under a `domain/` folder of a package's src. */
export function isDomainFile(path: string): boolean {
  return DOMAIN_FILE.test(path) && !path.endsWith(".d.ts");
}

/** Each call to an I/O or clock global in a `domain/` file, outside a comment, as `<path>:<line> <call>`. */
export function impureCalls(files: { path: string; text: string }[]): string[] {
  const found: string[] = [];
  for (const { path, text } of files) {
    if (!isDomainFile(path)) continue;
    text.split("\n").forEach((line, index) => {
      if (COMMENT_LINE.test(line)) return;
      for (const match of line.matchAll(IMPURE_CALL))
        found.push(`${path}:${index + 1} ${match[0]}`);
    });
  }
  return found;
}
