/**
 * Issue #1591: the down-only baseline of the domain borders. `.dependency-cruiser-known-violations.json`
 * lists today's violations of `.dependency-cruiser.cjs`; `depcruise --ignore-known` fails on a new
 * one, and this check fails when the baseline itself grows against main, rule by rule. A move may
 * rewrite the entries (their paths change), so the count per rule is what may not go up.
 */

export const KNOWN = ".dependency-cruiser-known-violations.json";
export const CONFIG = ".dependency-cruiser.cjs";

/** How many known violations each rule has; an unreadable or missing file has none. */
export function ruleCounts(known: string | null): Record<string, number> {
  let entries: unknown;
  try {
    entries = JSON.parse(known ?? "[]");
  } catch {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = (entry as { rule?: { name?: unknown } }).rule?.name;
    if (typeof name === "string") counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** The rules whose count went up from `base` to `head`, as `<rule>: <base> -> <head>`. */
export function grownRules(base: Record<string, number>, head: Record<string, number>): string[] {
  return Object.entries(head)
    .filter(([rule, count]) => count > (base[rule] ?? 0))
    .map(([rule, count]) => `${rule}: ${base[rule] ?? 0} -> ${count}`);
}

/** The names a `.dependency-cruiser.cjs` declares (`name: "<rule>"`); null when none can be read. */
function ruleNames(config: string | null): Set<string> | null {
  if (config === null) return null;
  const names = new Set(
    [...config.matchAll(/\bname:\s*"([^"]+)"/g)].map((found) => found[1] as string),
  );
  return names.size > 0 ? names : null;
}

/**
 * The rules the head's config adds to main's, which may bring their first baseline (#1624). Nothing
 * is new when either config cannot be read or the head drops a rule main has: a rename must not
 * give the renamed rule a free baseline.
 */
export function newRules(baseConfig: string | null, headConfig: string | null): Set<string> {
  const base = ruleNames(baseConfig);
  const head = ruleNames(headConfig);
  if (!base || !head || [...base].some((rule) => !head.has(rule))) return new Set();
  return new Set([...head].filter((rule) => !base.has(rule)));
}

/** The ratchet over git: the baseline at the merge-base with main against the working copy. */
export function runArchRatchet(deps: {
  git: (args: string[]) => string | null;
  readFile: (path: string) => string | null;
}): { code: number; output: string } {
  const base = ["origin/main", "main"]
    .map((main) => deps.git(["merge-base", "HEAD", main])?.trim())
    .find((found) => found);
  const head = ruleCounts(deps.readFile(KNOWN));
  const counts = Object.entries(head)
    .map(([rule, count]) => `${rule} ${count}`)
    .join(", ");
  const onMain = base ? deps.git(["show", `${base}:${KNOWN}`]) : null;
  if (onMain === null)
    return {
      code: 0,
      output: `arch-ratchet: no ${KNOWN} on main yet; this one is the first baseline (${counts})`,
    };
  // A rule main does not declare has no baseline to grow: the PR that adds it records its first one.
  const added = newRules(
    base ? deps.git(["show", `${base}:${CONFIG}`]) : null,
    deps.readFile(CONFIG),
  );
  const known = Object.fromEntries(Object.entries(head).filter(([rule]) => !added.has(rule)));
  const grown = grownRules(ruleCounts(onMain), known);
  if (grown.length > 0)
    return {
      code: 1,
      output: [
        `arch-ratchet: ${KNOWN} grew against main; it only goes down (#1591):`,
        ...grown.map((line) => `  - ${line}`),
        "Fix the new import instead: reach another domain through its index.ts, and break the cycle.",
      ].join("\n"),
    };
  return { code: 0, output: `arch-ratchet: no rule's known violations grew (${counts})` };
}
