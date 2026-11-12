/**
 * Issue #1609: parse, don't validate. A raw `JSON.parse` in an app's or a package's source hands the
 * domain an `unknown` it then casts; each adapter that reads outside data should parse it with a zod
 * schema at the edge. json-parse-baseline.json holds how many raw calls each file still has and only
 * goes down (`overBaseline` of the layout ratchet); the conversions come one domain per PR.
 */

const SOURCE = /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/;
/** The helpers that parse text into a checked value (#927, #1609) are the places a raw call belongs. */
const HELPERS = [
  "apps/daemon/src/kernel/json-text.ts",
  "apps/desktop/src/shared/lib/stored-json.ts",
];

/** Whether the check reads this tracked path: TypeScript under a package's src, minus the helper and declarations. */
export function isScanned(path: string): boolean {
  return SOURCE.test(path) && !path.endsWith(".d.ts") && !HELPERS.includes(path);
}

const CALL = /\bJSON\.parse\(/g;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** The scanned files with a raw `JSON.parse(` call outside a comment, with how many they hold. */
export function rawJsonParseCounts(
  files: { path: string; text: string }[],
): Record<string, number> {
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
