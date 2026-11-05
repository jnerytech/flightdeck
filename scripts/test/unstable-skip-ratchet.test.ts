import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UNSTABLE_ROOTS, unstableSkipCounts } from "../lib/unstable-skip.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** The most unstable skips the repository may hold: lower it when one comes off, never raise it. */
const UNSTABLE_SKIP_MAX = 5;

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

  test("the five wall-clock tests of the first run are the ones skipped, once each", () => {
    expect(
      Object.entries(counts)
        .map(([file, c]) => `${file}: ${c.total}`)
        .sort(),
    ).toEqual([
      "apps/daemon/test/heartbeat.test.ts: 1",
      "apps/desktop/test/hub-list.test.tsx: 1",
      "apps/desktop/test/platform.test.ts: 1",
      "apps/desktop/test/proto-restore.test.ts: 1",
      "apps/desktop/test/wait.test.ts: 1",
    ]);
  });
});
