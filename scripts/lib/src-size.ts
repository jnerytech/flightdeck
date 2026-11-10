/**
 * Issue #1592: the size of the source files, locked. A file past 800 lines likely holds two
 * responsibilities (CLAUDE.md, "Structure"): one over the limit must be in src-size-baseline.json,
 * which only goes down (`overBaseline` of the layout ratchet). The report of shallow modules
 * (Ousterhout: a file under 50 lines that only forwards another module) is a signal, not a gate.
 */

/** The line limit of a source file. */
export const SRC_LIMIT = 800;

const SOURCE = /^(apps|packages)\/[^/]+\/src\/.+\.tsx?$/;
/** Vendored shadcn ui, the dictionaries until their split (#1598), and declaration files. */
const EXCLUDED = [
  /^apps\/desktop\/src\/components\/ui\//,
  /^apps\/desktop\/src\/i18n\/(en|pt-BR)\.ts$/,
  /\.d\.ts$/,
];

/** Whether the size check reads this tracked path: TypeScript under a package's src, minus the exclusions. */
export function isMeasured(path: string): boolean {
  return SOURCE.test(path) && !EXCLUDED.some((rule) => rule.test(path));
}

/** The line count of a text, a last newline not counting as a line. */
function lineCount(text: string): number {
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** The measured files over the limit, with their line counts. */
export function oversizedSources(files: { path: string; text: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { path, text } of files) {
    const n = lineCount(text);
    if (isMeasured(path) && n > SRC_LIMIT) counts[path] = n;
  }
  return counts;
}

/** An import or a re-export statement, with the module it names. */
const FORWARD = /\b(import|export)\b[^;]*?\bfrom\s*["']([^"']+)["'];?/g;
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** The measured files under 50 lines that only forward one other module. */
export function shallowModules(files: { path: string; text: string }[]): string[] {
  return files
    .filter(({ path, text }) => {
      if (!isMeasured(path) || lineCount(text) >= 50) return false;
      const code = text.replace(COMMENTS, "");
      const statements = [...code.matchAll(FORWARD)];
      const modules = new Set(statements.map((m) => m[2]));
      const rest = code.replace(FORWARD, "").trim();
      return rest === "" && modules.size === 1 && statements.some((m) => m[1] === "export");
    })
    .map(({ path }) => path)
    .sort((a, b) => (a < b ? -1 : Number(a > b)));
}

/** The domain folder of a path: `apps/<app>/src/<domain>`, or `.../src/features/<domain>`. */
function domainOf(path: string): string {
  const parts = path.split("/");
  return parts.slice(0, parts[3] === "features" ? 5 : 4).join("/");
}

/** The domains with more than five shallow modules, as `<domain> (<n>)`. */
export function crowdedDomains(shallow: string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of shallow) counts.set(domainOf(path), (counts.get(domainOf(path)) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 5).map(([domain, n]) => `${domain} (${n})`);
}
