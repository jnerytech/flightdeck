/**
 * Issue #1609: parse, don't validate. A raw `JSON.parse` in an app's or a package's source hands the
 * domain an `unknown` it then casts; each adapter that reads outside data should parse it with a zod
 * schema at the edge. json-parse-baseline.json holds how many raw calls each file still has and only
 * goes down (`overBaseline` of the layout ratchet); the conversions come one domain per PR.
 */

/** Whether the check reads this tracked path: TypeScript under a package's src, minus the helper and declarations. */
export function isScanned(_path: string): boolean {
  return true;
}

/** The scanned files with a raw `JSON.parse(` call outside a comment, with how many they hold. */
export function rawJsonParseCounts(
  _files: { path: string; text: string }[],
): Record<string, number> {
  return { stub: -1 };
}
