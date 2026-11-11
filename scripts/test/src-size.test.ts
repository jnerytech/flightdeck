import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import {
  crowdedDomains,
  isMeasured,
  oversizedSources,
  SRC_LIMIT,
  shallowModules,
} from "../lib/src-size.ts";

// repo-wide (#1108): reads every tracked source file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../..");
const lines = (n: number) => "x\n".repeat(n);

describe("src-size (#1592)", () => {
  test("TypeScript under a package's src is measured; vendored ui, the dictionaries and .d.ts are not", () => {
    expect(isMeasured("apps/daemon/src/main.ts")).toBe(true);
    expect(isMeasured("apps/desktop/src/ui/BoardView.tsx")).toBe(true);
    expect(isMeasured("packages/protocol/src/index.ts")).toBe(true);
    expect(isMeasured("apps/desktop/src/i18n/en/board.ts")).toBe(true);
    expect(isMeasured("apps/desktop/src/components/ui/button.tsx")).toBe(false);
    expect(isMeasured("apps/desktop/src/i18n/en.ts")).toBe(false);
    expect(isMeasured("apps/desktop/src/i18n/pt-BR.ts")).toBe(false);
    expect(isMeasured("apps/daemon/src/text-modules.d.ts")).toBe(false);
    expect(isMeasured("apps/daemon/test/board/board.test.ts")).toBe(false);
    expect(isMeasured("scripts/lib/slot.ts")).toBe(false);
    expect(isMeasured("apps/desktop/src/styles.css")).toBe(false);
  });

  test("a planted 801-line file is over the limit; 800 lines and unmeasured files are not", () => {
    expect(SRC_LIMIT).toBe(800);
    expect(
      oversizedSources([
        { path: "apps/daemon/src/board/big.ts", text: lines(801) },
        { path: "apps/daemon/src/board/ok.ts", text: lines(800) },
        { path: "apps/desktop/src/i18n/en.ts", text: lines(6000) },
      ]),
    ).toEqual({ "apps/daemon/src/board/big.ts": 801 });
  });

  test("a new file over the limit, or a baseline file that grew, fails the ratchet", () => {
    const counts = oversizedSources([
      { path: "apps/daemon/src/main.ts", text: lines(2900) },
      { path: "apps/daemon/src/new.ts", text: lines(801) },
    ]);
    expect(overBaseline(counts, { "apps/daemon/src/main.ts": 2865 })).toEqual([
      "apps/daemon/src/main.ts: 2900 > 2865",
      "apps/daemon/src/new.ts: 801 > 0",
    ]);
  });

  test("a short file that only forwards one module is shallow; one with its own work, or two sources, is not", () => {
    const forward =
      'export { start, stop } from "./session-manager.ts";\nexport type { Session } from "./session-manager.ts";\n';
    const reexportAll = '// The board\'s entry.\nexport * from "./board.ts";\n';
    const work = 'import { a } from "./a.ts";\nexport const twice = (n: number) => a(n) * 2;\n';
    const two = 'export * from "./a.ts";\nexport * from "./b.ts";\n';
    expect(
      shallowModules([
        { path: "apps/daemon/src/sessions/index.ts", text: forward },
        { path: "apps/daemon/src/board/index.ts", text: reexportAll },
        { path: "apps/daemon/src/board/twice.ts", text: work },
        { path: "apps/daemon/src/hosts/index.ts", text: two },
        {
          path: "apps/daemon/src/big/index.ts",
          text: `${'export * from "./x.ts";\n'}${lines(60)}`,
        },
      ]),
    ).toEqual(["apps/daemon/src/board/index.ts", "apps/daemon/src/sessions/index.ts"]);
  });

  test("a domain with more than five shallow modules is named", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => `apps/daemon/src/board/f${n}.ts`);
    const five = [1, 2, 3, 4, 5].map((n) => `apps/desktop/src/features/board/f${n}.ts`);
    expect(crowdedDomains([...six, ...five])).toEqual(["apps/daemon/src/board (6)"]);
  });

  test("no tracked source file is over 800 lines beyond src-size-baseline.json", () => {
    const paths = spawnSync("git", ["ls-files", "apps/*/src/**", "packages/*/src/**"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(isMeasured);
    expect(paths.length).toBeGreaterThan(500);
    const counts = oversizedSources(
      paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })),
    );
    const file = join(ROOT, "src-size-baseline.json");
    const baseline = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    expect(overBaseline(counts, baseline)).toEqual([]);
    expect(counts["apps/daemon/src/main.ts"]).toBeGreaterThan(SRC_LIMIT);
  });
});
