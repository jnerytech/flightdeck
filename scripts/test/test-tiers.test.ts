import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { testTiers, tierCounts } from "../lib/test-tiers.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** A small tree of tests and helpers, as the classifier reads them. */
const FIXTURE = new Map<string, string>([
  ["apps/x/test/pure.test.ts", 'import { add } from "../src/add.ts";\ntest("a", () => add(1, 2));'],
  [
    "apps/x/test/screen.test.tsx",
    'import { registerDom } from "./dom.ts";\nimport { memoryPlatform, waitFor } from "./fixtures.ts";\nregisterDom();\nmemoryPlatform();',
  ],
  [
    "apps/x/test/with-daemon.test.tsx",
    'import { registerDom } from "./dom.ts";\nimport { daemon } from "./fixtures.ts";\nregisterDom();\nconst d = await daemon();',
  ],
  ["apps/x/test/through-helper.test.ts", 'import { boot } from "./boot.ts";\nawait boot();'],
  ["apps/x/test/spawns.test.ts", 'const p = Bun.spawn(["git", "status"]);'],
  [
    "apps/x/test/waits.test.ts",
    'import { waitFor } from "./fixtures.ts";\nawait waitFor(() => 1);',
  ],
  [
    "apps/x/test/dom.ts",
    "export function registerDom() {}\nexport function liveScreen() { registerDom(); }",
  ],
  [
    "apps/x/test/fixtures.ts",
    [
      'import { startServer } from "../src/server.ts";',
      "// waitFor polls; the daemon() below is the one that starts a server.",
      "export async function waitFor(check: () => unknown) { /* not daemon() */ return check(); }",
      "export function daemon() { return startServer({}); }",
      "export function memoryPlatform() { return {}; }",
    ].join("\n"),
  ],
  [
    "apps/x/test/boot.ts",
    'import { daemon } from "./fixtures.ts";\nexport async function boot() { return daemon(); }',
  ],
  ["apps/x/src/add.ts", "export const add = (a: number, b: number) => a + b;"],
  ["scripts/e2e/journeys.e2e.ts", 'test("j", async () => {});'],
  ["scripts/smoke-ops.ts", "await main();"],
  ["scripts/lib/plain.ts", "export const x = 1;"],
]);

describe("test-tiers", () => {
  test("processes, a server or real git make integration; the DOM makes component; the rest is unit", () => {
    expect(testTiers(FIXTURE)).toEqual({
      "apps/x/test/pure.test.ts": "unit",
      "apps/x/test/screen.test.tsx": "component",
      "apps/x/test/with-daemon.test.tsx": "integration",
      "apps/x/test/through-helper.test.ts": "integration",
      "apps/x/test/spawns.test.ts": "integration",
      "apps/x/test/waits.test.ts": "unit",
      "scripts/e2e/journeys.e2e.ts": "e2e",
      "scripts/smoke-ops.ts": "e2e",
    });
  });

  test("the counts per tier", () => {
    expect(tierCounts(testTiers(FIXTURE))).toEqual({
      unit: 2,
      component: 1,
      integration: 3,
      e2e: 2,
    });
  });

  test("test-tiers.json is the classifier's answer for this tree, so every test file has a tier", () => {
    const tracked = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean);
    const sources = new Map(tracked.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
    const manifest = JSON.parse(readFileSync(join(ROOT, "test-tiers.json"), "utf8"));
    // A stale manifest: run `bun run test:tiers -- --write`.
    expect(manifest).toEqual(testTiers(sources));
    const tests = tracked.filter((path) => /\.test\.tsx?$/.test(path));
    expect(tests.filter((path) => !(path in manifest))).toEqual([]);
  });
});
