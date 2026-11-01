/**
 * Which packages the app's entry point loads at start-up: the static imports reachable from it.
 * A package behind `import()` is not in the entry chunk, so a heavy one that shows up here is a
 * regression of the code split (phase 28, `bundle-lazy`).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const IMPORT =
  /^[ \t]*(import|export)\s+(type\s+)?(?:([\w*{}\s,$]+?)\s+from\s+)?["']([^"']+)["']/gm;
const ONLY_TYPES = /^\{\s*(?:type\s+[\w$]+(?:\s+as\s+[\w$]+)?\s*,?\s*)+\}$/;

/** The module specifiers a source file imports at load time (type-only imports do not load). */
export function staticImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  return [...code.matchAll(IMPORT)]
    .filter(([, , type, names]) => !type && !(names && ONLY_TYPES.test(names.trim())))
    .map((match) => match[4] as string);
}

/** The package a bare specifier belongs to (`@scope/name/sub` is `@scope/name`), else null. */
export function packageOf(specifier: string): string | null {
  if (/^(\.|@\/|node:)/.test(specifier)) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
}

export interface Reached {
  package: string;
  /** The files from the entry to the one that imports it. */
  via: string[];
}

const watches = (watched: string[], name: string) =>
  watched.some((w) => (w.endsWith("/") ? name.startsWith(w) : name === w));

/**
 * Follows the static imports from `entries` through the files under `srcRoot` (relative paths and
 * `@/` for `srcRoot`) and returns, for each package in `watched`, the first chain that reaches it.
 * A watched name ending in `/` stands for every package that starts with it.
 */
export function reachedPackages(entries: string[], srcRoot: string, watched: string[]): Reached[] {
  const found = new Map<string, string[]>();
  const seen = new Set(entries);
  const queue = entries.map((file) => [file]);
  for (let chain = queue.shift(); chain; chain = queue.shift()) {
    const file = chain.at(-1) as string;
    for (const specifier of staticImports(readFileSync(join(srcRoot, file), "utf8"))) {
      const name = packageOf(specifier);
      if (name) {
        if (watches(watched, name) && !found.has(name)) found.set(name, chain);
        continue;
      }
      const target = specifier.startsWith("@/")
        ? specifier.slice(2)
        : relative(srcRoot, resolve(srcRoot, dirname(file), specifier));
      const real = existsSync(join(srcRoot, target)) ? target : null;
      if (real && !seen.has(real)) {
        seen.add(real);
        queue.push([...chain, real]);
      }
    }
  }
  return [...found].map(([name, via]) => ({ package: name, via }));
}
