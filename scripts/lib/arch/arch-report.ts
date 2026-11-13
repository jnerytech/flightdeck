/**
 * Issue #1610: one table of every structure ratchet, each baseline against today's count. The
 * ratchets themselves (dependency-cruiser, src-size, test-layout) stay where they are and still
 * fail on growth; this reads their baselines and prints them together, for the terminal, the CI
 * job summary and a JSON file to follow the trend.
 */
import { ruleCounts } from "../ratchets/arch.ts";

export type RatchetRow = { ratchet: string; baseline: number; today: number };

export type ArchInputs = {
  /** `.dependency-cruiser-known-violations.json` at the merge-base with main, and in the working copy. */
  knownBase: string | null;
  knownHead: string | null;
  /** The rules the head's `.dependency-cruiser.cjs` adds to main's (`newRules`); today is their first baseline (#1624). */
  newRules?: ReadonlySet<string>;
  /** The desktop's files in an import cycle today and in desktop-cycles-baseline.json (#1624); absent when not counted. */
  desktopCycles?: { today: number; baseline: number };
  /** Calls to an I/O or clock global in a `domain/` file today (#1601); none is allowed, so the baseline is 0. */
  domainImpureCalls?: number;
  /** Source files over the size limit today and in src-size-baseline.json. */
  srcOversized: Record<string, number>;
  srcBaseline: Record<string, number>;
  /** Flat test files per workspace today and in test-layout-baseline.json. */
  flatCounts: Record<string, number>;
  flatBaseline: Record<string, number>;
  /** Dead-code findings by kind today (knip) and in knip-baseline.json. */
  knipCounts: Record<string, number>;
  knipBaseline: Record<string, number>;
  /** Raw `JSON.parse` calls per source file today and in json-parse-baseline.json. */
  jsonParseCounts: Record<string, number>;
  jsonParseBaseline: Record<string, number>;
  /** The share of test files per upper tier today (integration, e2e), in basis points, and in test-shape-baseline.json. */
  shapeShares: Record<string, number>;
  shapeBaseline: Record<string, number>;
};

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** The share of the test files in the integration and e2e tiers (#1854), in basis points, rounded up. */
export function shapeShares(filesByTier: Record<string, number>): Record<string, number> {
  const total = sum(filesByTier);
  const share = (tier: string) =>
    total === 0 ? 0 : Math.ceil(((filesByTier[tier] ?? 0) * 10_000) / total);
  return { integration: share("integration"), e2e: share("e2e") };
}

/** The desktop cycle baseline (`{ "files": n }`): the head's file may lower main's, never raise it (#1624). */
export function cycleBaseline(onMain: string | null, head: string | null): number {
  const files = (text: string | null): number | null => {
    try {
      const value = (JSON.parse(text ?? "{}") as { files?: unknown }).files;
      return typeof value === "number" ? value : null;
    } catch {
      return null;
    }
  };
  const own = files(head);
  const base = files(onMain);
  if (own === null) return 0; // unreadable: nothing is allowed
  return base === null ? own : Math.min(base, own);
}

/** One row per ratchet figure, sorted by name. */
export function ratchetRows(inputs: ArchInputs): RatchetRow[] {
  const rows: RatchetRow[] = [];
  if (inputs.knownBase !== null || inputs.knownHead !== null) {
    const head = ruleCounts(inputs.knownHead);
    // no file on main yet (arch-ratchet.ts agrees): today is the first baseline
    const base = inputs.knownBase === null ? head : ruleCounts(inputs.knownBase);
    for (const rule of new Set([...Object.keys(base), ...Object.keys(head)]))
      rows.push({
        ratchet: `depcruise ${rule}`,
        baseline: inputs.newRules?.has(rule) ? (head[rule] ?? 0) : (base[rule] ?? 0),
        today: head[rule] ?? 0,
      });
  }
  if (inputs.desktopCycles)
    rows.push({
      ratchet: "desktop-cycles files in a cycle",
      baseline: inputs.desktopCycles.baseline,
      today: inputs.desktopCycles.today,
    });
  if (inputs.domainImpureCalls !== undefined)
    rows.push({
      ratchet: "domain-purity impure calls",
      baseline: 0,
      today: inputs.domainImpureCalls,
    });
  rows.push({
    ratchet: "src-size files over the limit",
    baseline: Object.keys(inputs.srcBaseline).length,
    today: Object.keys(inputs.srcOversized).length,
  });
  rows.push({
    ratchet: "json-parse raw calls",
    baseline: sum(inputs.jsonParseBaseline),
    today: sum(inputs.jsonParseCounts),
  });
  for (const tier of new Set([
    ...Object.keys(inputs.shapeBaseline),
    ...Object.keys(inputs.shapeShares),
  ]))
    rows.push({
      ratchet: `test-shape ${tier} share (basis points)`,
      baseline: inputs.shapeBaseline[tier] ?? 0,
      today: inputs.shapeShares[tier] ?? 0,
    });
  for (const kind of new Set([
    ...Object.keys(inputs.knipBaseline),
    ...Object.keys(inputs.knipCounts),
  ]))
    rows.push({
      ratchet: `knip ${kind}`,
      baseline: inputs.knipBaseline[kind] ?? 0,
      today: inputs.knipCounts[kind] ?? 0,
    });
  for (const workspace of new Set([
    ...Object.keys(inputs.flatBaseline),
    ...Object.keys(inputs.flatCounts),
  ]))
    rows.push({
      ratchet: `test-layout ${workspace}`,
      baseline: inputs.flatBaseline[workspace] ?? 0,
      today: inputs.flatCounts[workspace] ?? 0,
    });
  return rows.sort((a, b) => (a.ratchet < b.ratchet ? -1 : Number(a.ratchet > b.ratchet)));
}

/** The rows whose count is above its baseline. */
export function growing(rows: RatchetRow[]): RatchetRow[] {
  return rows.filter((row) => row.today > row.baseline);
}

/** A markdown table of the rows, with a status column (`ok`, `down` or `UP`). */
export function formatTable(rows: RatchetRow[]): string {
  const status = (row: RatchetRow) =>
    row.today > row.baseline ? "UP" : row.today < row.baseline ? "down" : "ok";
  return [
    "| Ratchet | Baseline | Today | Status |",
    "| --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.ratchet} | ${row.baseline} | ${row.today} | ${status(row)} |`),
  ].join("\n");
}

export type EntryRow = { entry: string; base: number | null; today: number; broad: boolean };

/** Growth of an entry's export count in one PR that gets flagged (#1624), as a share of its count on main. */
const ENTRY_GROWTH = 0.2;

/** Whether a tracked path is a domain's `index.ts` under a package's `src`; plain path characters only, as the table prints it (#1624). */
export function isEntry(path: string): boolean {
  return /^(?:apps|packages)\/[\w.-]+\/src\/(?:[\w.-]+\/)*index\.ts$/.test(path);
}

/** The text without `/* ... *\/` comments, in one pass: an unterminated one runs to the end. */
function withoutBlockComments(text: string): string {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf("/*", at);
    if (open === -1) return [...parts, text.slice(at)].join("");
    parts.push(text.slice(at, open));
    const close = text.indexOf("*/", open + 2);
    if (close === -1) return parts.join("");
    at = close + 2;
  }
}

/** The names the `export { ... }` lists of a text hold (the alias of `a as b`), scanning forward once: an unclosed one ends the scan. */
function listedNames(text: string): string[] {
  const opening = /^export\s+(?:type\s+)?\{/gm;
  const names: string[] = [];
  for (let found = opening.exec(text); found; found = opening.exec(text)) {
    const close = text.indexOf("}", opening.lastIndex);
    if (close === -1) break;
    for (const item of text.slice(opening.lastIndex, close).split(",")) {
      const name = item
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.push(name);
    }
    opening.lastIndex = close + 1;
  }
  return names;
}

/**
 * The distinct names an entry exports (a value and a type of one name are one) and whether it has a
 * bare `export * from` (#1624); comments are skipped. An entry is PR code, so every scan is linear:
 * a stalled regex would hang the CI job.
 */
function exportsOf(source: string): { count: number; broad: boolean } {
  const text = withoutBlockComments(source).replaceAll(/(^|[^:])\/\/.*$/gm, "$1");
  const declared = text.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+(\w+)/gm,
  );
  const namespaced = text.matchAll(/^export\s*\*\s*as\s+(\w+)/gm);
  const names = new Set([
    ...listedNames(text),
    ...[...declared, ...namespaced].map((found) => found[1]),
    ...(/^export\s+default\b/m.test(text) ? ["default"] : []),
  ]);
  return { count: names.size, broad: /^export\s*\*\s*from/m.test(text) };
}

/** One row per entry in `today` (path to source text), against the same entry in `base`, sorted by path (#1624). */
export function entryRows(
  today: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string>,
): EntryRow[] {
  return [...today.entries()]
    .map(([entry, source]) => {
      const now = exportsOf(source);
      const before = base.get(entry);
      return {
        entry,
        base: before === undefined ? null : exportsOf(before).count,
        today: now.count,
        broad: now.broad,
      };
    })
    .sort((a, b) => (a.entry < b.entry ? -1 : Number(a.entry > b.entry)));
}

const entryNote = (row: EntryRow): string => {
  const notes = [];
  if (row.broad) notes.push("broad (export *)");
  if (row.base !== null && row.today > row.base * (1 + ENTRY_GROWTH))
    notes.push(
      `grew ${row.base === 0 ? "from 0" : `${Math.ceil(((row.today - row.base) / row.base) * 100)}%`} (over ${ENTRY_GROWTH * 100}%)`,
    );
  return notes.join("; ");
};

/** A markdown table of the entries with a note for a broad one and for a growth over 20% (#1624). */
export function formatEntries(rows: EntryRow[]): string {
  return [
    "| Entry | On main | Today | Note |",
    "| --- | ---: | ---: | --- |",
    ...rows.map(
      (row) => `| ${row.entry} | ${row.base ?? "-"} | ${row.today} | ${entryNote(row)} |`,
    ),
  ].join("\n");
}
