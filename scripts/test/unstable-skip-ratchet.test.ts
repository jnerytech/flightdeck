import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  closedSkipIssues,
  skipIssues,
  UNSTABLE_ROOTS,
  unstableSkipCounts,
  unstableSkipIssues,
  unstableSkips,
} from "../lib/unstable-skip.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");

/**
 * The most unstable skips the repository may hold (#494: "testes intermitentes que prejudicam o CI
 * pode dar skip"): a flaky test may be skipped under its open issue, and only so many at once.
 */
const UNSTABLE_SKIP_MAX = 10;

// Built by concatenation so this very file holds none of the skips it counts.
const skipOff = (head: string) => `${head}.${"skip"}${"If"}(notLinux)("x", () => {});`;

describe("unstable-skip-ratchet: tests skipped off Linux name their issue, and there are only so many (issue #288)", () => {
  test("it counts the skips off Linux per test file, with those that have no complete note", () => {
    const root = realTempDir("fd-unstable-skip-");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put(
      "apps/daemon/test/a.test.ts",
      `// unstable: #288 polls\n${skipOff("test")}\n${skipOff("it")}\n`,
    );
    put("apps/desktop/test/b.test.tsx", `${skipOff("describe")} // unstable: #7 spawns\n`);
    put(
      "scripts/test/clean.test.ts",
      `test.${"skip"}${"If"}(process.platform === "win32")("x", () => {});\n`,
    );
    put("apps/daemon/test/helpers.ts", `${skipOff("test")}\n`);
    put("apps/daemon/test/node_modules/x/e.test.ts", `${skipOff("test")}\n`);
    expect(unstableSkipCounts(root)).toEqual({
      "apps/daemon/test/a.test.ts": { total: 2, undocumented: 1 },
      "apps/desktop/test/b.test.tsx": { total: 1, undocumented: 0 },
    });
    expect(UNSTABLE_ROOTS).toEqual([
      "apps/daemon/test",
      "apps/desktop/test",
      "packages/protocol/test",
      "scripts/test",
    ]);
  });

  const counts = unstableSkipCounts(ROOT);

  test("every skip off Linux in the repository has an issue number and a reason", () => {
    const bad = Object.entries(counts)
      .filter(([, c]) => c.undocumented > 0)
      .map(([file, c]) => `${file}: ${c.undocumented}`);
    expect(bad).toEqual([]);
  });

  test("the repository holds no more than the maximum", () => {
    const total = Object.values(counts).reduce((sum, c) => sum + c.total, 0);
    expect(total).toBeLessThanOrEqual(UNSTABLE_SKIP_MAX);
  });

  test("a flaky test may be skipped on any platform with the note, and the note names its issue (#494)", () => {
    const plain = (head: string) => `${head}.${"skip"}("x", () => {});`;
    const source = [
      "// unstable: #484 the keep-awake panel reads the status late on a loaded runner",
      plain("test"),
      `${plain("it")} // unstable: #492 the palette's entries arrive after ArrowDown`,
      plain("describe"),
      `test.${"skip"}${"If"}(notLinux)("y", () => {}); // unstable: #288 polls`,
    ].join("\n");
    expect(unstableSkips(source)).toEqual([
      { line: 2, documented: true },
      { line: 3, documented: true },
      { line: 4, documented: false },
      { line: 5, documented: true },
    ]);
    expect(skipIssues(source)).toEqual([484, 492, 288]);
  });

  test("the repository's noted issues are read from every test file under the roots, each once, in order (#494)", () => {
    const root = realTempDir("fd-unstable-issues-");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    const plain = `test.${"skip"}("x", () => {});`;
    put(
      "apps/daemon/test/a.test.ts",
      `// unstable: #7 late\n${plain}\n// unstable: #5 races\n${plain}\n`,
    );
    put("scripts/test/b.test.ts", `${plain} // unstable: #7 late again\n`);
    put("docs/c.test.ts", `${plain} // unstable: #9 outside the roots\n`);
    expect(unstableSkipIssues(root)).toEqual([5, 7]);
  });

  test("a skip whose issue is closed fails the check, so the skip comes out with the fix; an issue that cannot be read fails too (#494)", async () => {
    const states: Record<number, string> = { 484: "open", 492: "closed" };
    const result = await closedSkipIssues([484, 492, 999, 484], async (n) => states[n] ?? null);
    expect(result).toEqual({ closed: [492], unknown: [999] });
  });
});
