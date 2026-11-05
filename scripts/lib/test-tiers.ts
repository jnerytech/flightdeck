/**
 * Test tiers by content (issue #261), without renaming a file: a test that starts processes, a
 * server or real git is `integration`; one that draws the DOM is `component`; the rest is `unit`;
 * the Playwright journeys and the smokes are `e2e`. A helper counts function by function: a test
 * that takes only `waitFor` from fixtures.ts is not an integration test because `daemon()` sits in
 * the same file. The tiers are computed from the code on every call (about 100 ms for the tree);
 * no manifest is committed, so no PR has one to update or conflict in.
 */
import { byCodeUnit } from "@flightdeck/protocol";
import { importsOf, resolveImport } from "./test-related.ts";

export type Tier = "unit" | "component" | "integration" | "e2e";
export const TIERS: Tier[] = ["unit", "component", "integration", "e2e"];

const TEST_FILE = /\.test\.tsx?$/;
const E2E_FILE = /^scripts\/e2e\/.*\.e2e\.ts$|^scripts\/smoke-[^/]+\.ts$/;
/** A test's own helper: a module in a test folder that is not a test itself. */
const HELPER = /(^|\/)test\/[^/]+\.tsx?$/;
/** What makes a test integration: a process, a server, a socket, real git through a fake CLI. */
const INTEGRATION =
  /\bstartDaemon\b|\bstartServer\s*\(|\bBun\.spawn(?:Sync)?\s*\(|\bspawnSync\s*\(|\bspawn\s*\(|\bexecFileSync\s*\(|\bexecSync\s*\(|\binstallFake(?:Cli|Claude)\s*\(|\bFrameClient\b|\bBun\.serve\s*\(|\bnew WebSocket\s*\(|\bcreateServer\s*\(/;
/** What makes a test component: the DOM, registered or through Testing Library. */
const COMPONENT = /\bregisterDom\s*\(|@testing-library\//;

/** The code without its comments, so a word in a comment is not a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** A module's top-level exports, each with the text up to the next one. */
function exportsOf(text: string): Map<string, string> {
  const marks = [
    ...text.matchAll(/^export (?:async )?(?:function\*? |const |let |class )([A-Za-z_$][\w$]*)/gm),
  ];
  return new Map(
    marks.map((m, i) => [m[1] as string, text.slice(m.index, marks[i + 1]?.index ?? text.length)]),
  );
}

const calls = (text: string, names: Set<string>) =>
  [...names].some((name) => new RegExp(`\\b${name}\\s*(?:<[^>]*>)?\\(`).test(text));

/** The tier of every test file (and every journey and smoke) among these sources, by path. */
export function testTiers(sources: Map<string, string>): Record<string, Tier> {
  const known = new Set(sources.keys());
  const helpers = new Map<string, { heavy: Set<string>; dom: Set<string> }>();
  const imported = (path: string, text: string) => {
    const heavy = new Set<string>();
    const dom = new Set<string>();
    for (const spec of importsOf(text)) {
      const target = resolveImport(path, spec, known);
      if (!target || !HELPER.test(target) || TEST_FILE.test(target)) continue;
      const helper = helperOf(target);
      for (const name of helper.heavy) heavy.add(name);
      for (const name of helper.dom) dom.add(name);
    }
    return { heavy, dom };
  };
  /** The exported functions of a helper that start processes (heavy) or draw the DOM (dom). */
  const helperOf = (path: string) => {
    const cached = helpers.get(path);
    if (cached) return cached;
    const found = { heavy: new Set<string>(), dom: new Set<string>() };
    helpers.set(path, found);
    const text = code(sources.get(path) ?? "");
    const from = imported(path, text);
    const bodies = exportsOf(text);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, body] of bodies) {
        const inside = body.slice(body.indexOf(name) + name.length);
        if (
          !found.heavy.has(name) &&
          (INTEGRATION.test(body) || calls(inside, from.heavy) || calls(inside, found.heavy))
        ) {
          found.heavy.add(name);
          grew = true;
        }
        if (
          !found.dom.has(name) &&
          (COMPONENT.test(body) || calls(inside, from.dom) || calls(inside, found.dom))
        ) {
          found.dom.add(name);
          grew = true;
        }
      }
    }
    return found;
  };
  const tiers: Record<string, Tier> = {};
  for (const path of [...known].sort(byCodeUnit)) {
    if (E2E_FILE.test(path)) {
      tiers[path] = "e2e";
      continue;
    }
    if (!TEST_FILE.test(path)) continue;
    const text = code(sources.get(path) ?? "");
    const from = imported(path, text);
    if (INTEGRATION.test(text) || calls(text, from.heavy)) tiers[path] = "integration";
    else if (COMPONENT.test(text) || calls(text, from.dom)) tiers[path] = "component";
    else tiers[path] = "unit";
  }
  return tiers;
}

/** How many files each tier holds. */
export function tierCounts(tiers: Record<string, Tier>): Record<Tier, number> {
  const counts = { unit: 0, component: 0, integration: 0, e2e: 0 };
  for (const tier of Object.values(tiers)) counts[tier]++;
  return counts;
}
