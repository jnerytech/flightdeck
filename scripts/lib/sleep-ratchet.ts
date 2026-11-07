import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Test folders whose files the sleep ratchet counts, relative to the repository root. */
export const SLEEP_ROOTS: readonly string[] = [
  "apps/daemon/test",
  "apps/desktop/test",
  "packages/protocol/test",
  "scripts/test",
];

/**
 * A wait of a guessed time, in each of its spellings: `Bun.sleep(…)`, `Bun.sleepSync(…)`, a promise
 * that resolves from a timer (see `timerPromises`), and a call to a helper named `sleep` or `delay`
 * (its definition, `function sleep(`, is not a call).
 */
const BARE_SLEEPS = [/Bun\.sleep(?:Sync)?\(/g, /(?<![\w$.])(?<!function\s)(?:sleep|delay)\(/g];

const PROMISE = "new Promise";

/** What follows `new Promise` (and its generic) in a timer: the arrow, its body and `setTimeout(`. */
const TIMER_TAIL =
  /\(\s*(?:\(\s*)?\w+\s*(?:\)\s*)?=>\s*(?:\{\s*)?(?:globalThis\.|window\.)?setTimeout\(/y;

/**
 * Where a promise that resolves from a timer starts (the body may sit on the next line). The generic
 * `<…>` ends at the first `>`, found once for all the openers before it, so the scan stays linear.
 */
function timerPromises(code: string): number[] {
  const sites: number[] = [];
  let close = 0;
  let from = 0;
  for (let at = code.indexOf(PROMISE); at >= 0; at = code.indexOf(PROMISE, from)) {
    let tail = at + PROMISE.length;
    from = tail;
    if (code[tail] === "<") {
      if (close !== -1 && close <= tail) close = code.indexOf(">", tail + 1);
      if (close === -1) continue;
      tail = close + 1;
    }
    TIMER_TAIL.lastIndex = tail;
    const match = TIMER_TAIL.exec(code);
    if (match) {
      sites.push(at);
      from = tail + match[0].length;
    }
  }
  return sites;
}

/** The comment that says why the clock is the thing under test (a hold, a debounce). */
const TIMING_COMMENT = /^\s*\/\/ timing:/;

const LINE_END = /[\n\r\u2028\u2029]/g;

/** The source with each `//` comment cut to the end of its line; a `//` right after a colon is a URL. */
function withoutLineComments(source: string): string {
  let out = "";
  let kept = 0;
  let scan = 0;
  for (let at = source.indexOf("//"); at >= 0; at = source.indexOf("//", scan)) {
    if (source[at - 1] === ":") {
      scan = at + 1;
      continue;
    }
    out += source.slice(kept, at);
    LINE_END.lastIndex = at;
    kept = LINE_END.exec(source)?.index ?? source.length;
    scan = kept;
  }
  return out + source.slice(kept);
}

/** The source without its comments, with every line break kept so a match keeps its line. */
function withoutComments(source: string): string {
  return withoutLineComments(
    source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, "")),
  );
}

/**
 * How many fixed sleeps a test source holds. A guessed time is a bet on the machine: on a loaded
 * runner it is too short, and everywhere else it is time wasted. Wait on the condition (`settle`,
 * `findBy*`, `stays`); a sleep stays only with a `// timing:` comment on the line above saying why
 * the clock itself is under test.
 */
export function fixedSleeps(source: string): number {
  const lines = source.split("\n");
  const code = withoutComments(source);
  let sites = 0;
  const starts = [
    ...BARE_SLEEPS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match.index)),
    ...timerPromises(code),
  ];
  for (const start of starts) {
    const line = code.slice(0, start).split("\n").length - 1;
    let above = line - 1;
    while (above >= 0 && (lines[above] ?? "").trim() === "") above -= 1;
    if (above < 0 || !TIMING_COMMENT.test(lines[above] ?? "")) sites += 1;
  }
  return sites;
}

/** Every test file under the roots with its count of fixed sleeps (none left out), keyed under `root`. */
export function sleepCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(path);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        const n = fixedSleeps(readFileSync(path, "utf8"));
        if (n > 0) counts[relative(root, path).replaceAll("\\", "/")] = n;
      }
    }
  };
  for (const dir of SLEEP_ROOTS) {
    if (existsSync(join(root, dir))) walk(join(root, dir));
  }
  return counts;
}
