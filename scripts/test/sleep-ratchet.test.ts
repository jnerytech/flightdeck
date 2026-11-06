import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import { fixedSleeps, SLEEP_ROOTS, sleepCounts } from "../lib/sleep-ratchet.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = resolve(ROOT, "sleep-baseline.json");

describe("sleep-ratchet: a test waits on a condition, not on a guessed time (issue #274)", () => {
  test("Bun.sleep and Bun.sleepSync are fixed sleeps", () => {
    expect(fixedSleeps("await Bun.sleep(50);")).toBe(1);
    expect(fixedSleeps("await act(() => Bun.sleep(30));")).toBe(1);
    expect(fixedSleeps("Bun.sleepSync(5);")).toBe(1);
    expect(fixedSleeps("await Bun.sleep(5);\nawait Bun.sleep(5);")).toBe(2);
  });

  test("a promise that resolves from a timer is a fixed sleep, whatever its parameter is called", () => {
    expect(fixedSleeps("await new Promise((r) => setTimeout(r, 20));")).toBe(1);
    expect(fixedSleeps("await new Promise((resolve) => setTimeout(resolve, 20));")).toBe(1);
    expect(fixedSleeps("await new Promise<void>((done) => setTimeout(done, 20));")).toBe(1);
    expect(fixedSleeps("await new Promise((r) => globalThis.setTimeout(r, 20));")).toBe(1);
    expect(fixedSleeps("await new Promise((r) => {\n  setTimeout(r, 20);\n});")).toBe(1);
  });

  test("a call to a helper named sleep or delay is a fixed sleep, its definition is not", () => {
    expect(fixedSleeps("await sleep(10);")).toBe(1);
    expect(fixedSleeps("await delay(10);")).toBe(1);
    expect(fixedSleeps("const sleep = (ms: number) => Bun.sleep(ms);")).toBe(1);
    expect(fixedSleeps("function sleep(ms: number) {\n  return ms;\n}")).toBe(0);
    expect(fixedSleeps("obj.sleep(10); fallsleep(1); asleep(2);")).toBe(0);
  });

  test("a timer that is not awaited, and the fake clock, are not sleeps", () => {
    expect(fixedSleeps("setTimeout(() => done(), 0);")).toBe(0);
    expect(fixedSleeps("const t = setTimeout(fire, 100); clearTimeout(t);")).toBe(0);
    expect(fixedSleeps("clock.advanceTimersByTime(500);")).toBe(0);
    expect(fixedSleeps("await settle(() => ready());")).toBe(0);
  });

  test("a // timing: comment above says the clock is the thing under test, and the sleep is allowed", () => {
    expect(
      fixedSleeps("// timing: the hold window is what this test measures\nawait Bun.sleep(50);"),
    ).toBe(0);
    expect(fixedSleeps("  // timing: debounce\n\n  await Bun.sleep(50);")).toBe(0);
    expect(fixedSleeps("// a comment\nawait Bun.sleep(50);")).toBe(1);
    expect(fixedSleeps("// timing: one\nawait Bun.sleep(1);\nawait Bun.sleep(2);")).toBe(1);
  });

  test("a comment or a string that names a sleep is not one", () => {
    expect(fixedSleeps("// await Bun.sleep(50) hid the race\nconst a = 1;")).toBe(0);
    expect(fixedSleeps("/* Bun.sleep(5) */ const a = 1;")).toBe(0);
    expect(fixedSleeps("")).toBe(0);
  });

  test("it counts the test files of the four test folders and nothing else", () => {
    const root = realTempDir("fd-sleep-ratchet-");
    const put = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put("apps/daemon/test/a.test.ts", "await Bun.sleep(1);\nawait Bun.sleep(2);");
    put("apps/desktop/test/b.test.tsx", "await sleep(1);");
    put("packages/protocol/test/c.test.ts", "await Bun.sleep(1);");
    put("scripts/test/d.test.ts", "await Bun.sleep(1);");
    put("scripts/test/clean.test.ts", "await settle(() => ok());");
    put("apps/daemon/test/helpers.ts", "export const nap = () => Bun.sleep(1);");
    put("apps/daemon/test/fake-claude-main.ts", "await Bun.sleep(1000);");
    put("apps/daemon/src/real.ts", "await Bun.sleep(1000);");
    put("apps/daemon/test/node_modules/x/e.test.ts", "await Bun.sleep(1);");
    expect(sleepCounts(root)).toEqual({
      "apps/daemon/test/a.test.ts": 2,
      "apps/desktop/test/b.test.tsx": 1,
      "packages/protocol/test/c.test.ts": 1,
      "scripts/test/d.test.ts": 1,
    });
    expect(SLEEP_ROOTS).toEqual([
      "apps/daemon/test",
      "apps/desktop/test",
      "packages/protocol/test",
      "scripts/test",
    ]);
  });

  test("no test file of the repository sleeps more often than the baseline allows", () => {
    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>)
      : {};
    expect(overBaseline(sleepCounts(ROOT), baseline)).toEqual([]);
  });
});
