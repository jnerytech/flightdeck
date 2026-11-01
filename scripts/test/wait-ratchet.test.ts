import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { localWaits, waitCounts } from "../lib/wait-ratchet.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = resolve(ROOT, "wait-baseline.json");

describe("wait-ratchet: the test files' own waits only go down", () => {
  test("it counts a function or an arrow of its own named settle, waitFor or until", () => {
    const source = `
      async function settle(check: () => boolean) {}
      function waitForUi(check: () => boolean) {}
      export async function until(check: () => boolean) {}
      const waitFor = async (check: () => boolean) => {};
      const settleLater = (check: () => boolean) => {};
      const settle2 = waiter(4000);
      import { settle } from "./wait.ts";
      const untilNow = Date.now();
      // function settle() in a comment is still text: only definitions at line start count
    `;
    expect(localWaits(source)).toBe(5);
    expect(localWaits('import { settle } from "./wait.ts";\nawait settle(() => true);')).toBe(0);
  });

  test("no test file defines more of its own waits than the baseline allows", () => {
    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>)
      : {};
    const counts = {
      ...waitCounts(resolve(ROOT, "apps/desktop/test"), ROOT),
      ...waitCounts(resolve(ROOT, "apps/daemon/test"), ROOT),
    };
    expect(overBaseline(counts, baseline)).toEqual([]);
  });
});
