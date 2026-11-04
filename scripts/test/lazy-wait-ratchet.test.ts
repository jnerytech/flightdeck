import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overBaseline } from "../lib/layout-ratchet.ts";
import {
  actSleepCounts,
  fixedWaitCounts,
  fixedWaitSites,
  uncommentedActSleeps,
} from "../lib/lazy-wait-ratchet.ts";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BASELINE = resolve(ROOT, "lazy-wait-baseline.json");

describe("lazy-wait-ratchet: a fixed wait followed by a one-shot query only goes down", () => {
  test("a sleep, a timeout or a Bun.sleep followed by getBy or queryBy is a site", () => {
    const sleep = `await act(async () => Bun.sleep(5));\nexpect(screen.queryByRole("button")).not.toBeNull();`;
    const timer = `await new Promise((r) => setTimeout(r, 20));\nconst x = within(main).getByText("a");`;
    const named = `await sleep(10);\n\nconst rows = screen.getAllByRole("row");`;
    expect(fixedWaitSites(sleep)).toBe(1);
    expect(fixedWaitSites(timer)).toBe(1);
    expect(fixedWaitSites(named)).toBe(1);
    expect(fixedWaitSites(`${sleep}\n${timer}`)).toBe(2);
  });

  test("a wait that is followed by findBy, waitFor or a settle is fine", () => {
    expect(fixedWaitSites(`await Bun.sleep(5);\nawait screen.findByRole("button");`)).toBe(0);
    expect(fixedWaitSites(`await Bun.sleep(5);\nawait settle(() => ok());`)).toBe(0);
    expect(fixedWaitSites(`await Bun.sleep(5);\nawait waitFor(() => expect(1).toBe(1));`)).toBe(0);
  });

  test("a query far below the wait, or with no wait at all, is not a site", () => {
    const far = `await Bun.sleep(5);\n${"a();\n".repeat(8)}screen.queryByRole("button");`;
    expect(fixedWaitSites(far)).toBe(0);
    expect(fixedWaitSites(`screen.queryByRole("button");`)).toBe(0);
    expect(fixedWaitSites("")).toBe(0);
  });

  test("a query in the next block or function is not right after the wait", () => {
    const helper = `const click = async () => {\n  await act(() => Bun.sleep(30));\n};\n\nconst find = () => screen.queryByRole("button");`;
    const nested = `test("a", async () => {\n  if (x) {\n    await Bun.sleep(5);\n  }\n  screen.queryByRole("a");\n});`;
    expect(fixedWaitSites(helper)).toBe(1);
    expect(fixedWaitSites(nested)).toBe(0);
    expect(
      fixedWaitSites(`if (x) {\n  await Bun.sleep(5);\n  const a = screen.queryByRole("a");\n}`),
    ).toBe(1);
  });

  test("a helper that ends in a fixed wait is a site: every caller then reads once after a guess", () => {
    const arrow = `const click = async (name: string) => {\n  fireEvent.click(find(name));\n  await act(() => Bun.sleep(30));\n};\n`;
    const declared = `async function fill(label: string) {\n  change(label);\n  await Bun.sleep(10);\n}\n`;
    const inDescribe = `describe("a", () => {\n  const press = async () => {\n    go();\n    await act(() => Bun.sleep(20));\n  };\n});\n`;
    expect(fixedWaitSites(arrow)).toBe(1);
    expect(fixedWaitSites(declared)).toBe(1);
    expect(fixedWaitSites(inDescribe)).toBe(1);
  });

  test("a fixed wait with work after it, or in the middle of a test, is not a helper tail", () => {
    const work = `const click = async () => {\n  await act(() => Bun.sleep(30));\n  done();\n};\n`;
    const inTest = `test("a", async () => {\n  go();\n  await act(() => Bun.sleep(30));\n  expect(x).toBe(1);\n});\n`;
    const inIf = `const f = async () => {\n  if (x) {\n    await Bun.sleep(5);\n  }\n  done();\n};\n`;
    expect(fixedWaitSites(work)).toBe(0);
    expect(fixedWaitSites(inTest)).toBe(0);
    expect(fixedWaitSites(inIf)).toBe(0);
  });

  test("it counts per file, skips the files that hold the shared waits and files with none", () => {
    const dir = realTempDir("lazy-wait-");
    mkdirSync(resolve(dir, "sub"));
    const bad = `await Bun.sleep(5);\nscreen.queryByRole("a");\n`;
    writeFileSync(resolve(dir, "a.test.tsx"), bad + bad);
    writeFileSync(resolve(dir, "sub", "b.test.ts"), bad);
    writeFileSync(resolve(dir, "clean.test.ts"), "expect(1).toBe(1);\n");
    writeFileSync(resolve(dir, "wait.ts"), bad);
    writeFileSync(resolve(dir, "notes.md"), bad);
    expect(fixedWaitCounts(dir, dir)).toEqual({ "a.test.tsx": 2, "sub/b.test.ts": 1 });
  });

  test("no desktop test has more such sites than the baseline allows", () => {
    const baseline = existsSync(BASELINE)
      ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, number>)
      : {};
    expect(
      overBaseline(fixedWaitCounts(resolve(ROOT, "apps/desktop/test"), ROOT), baseline),
    ).toEqual([]);
  });
});

describe("lazy-wait-ratchet: an act sleep in a desktop test says why it waits", () => {
  test("an act(() => Bun.sleep(…)) with no reason above it is a site, in each of its spellings", () => {
    expect(uncommentedActSleeps("await act(() => Bun.sleep(30));")).toBe(1);
    expect(uncommentedActSleeps("await act(async () => Bun.sleep(30));")).toBe(1);
    expect(uncommentedActSleeps("await act(async () => await Bun.sleep(30));")).toBe(1);
    expect(uncommentedActSleeps("const wait = (ms: number) => act(() => Bun.sleep(ms));")).toBe(1);
    expect(
      uncommentedActSleeps("a();\nawait act(() => Bun.sleep(1));\nawait act(() => Bun.sleep(2));"),
    ).toBe(2);
  });

  test("a '// timing:' comment on the line above says why, and the sleep is allowed", () => {
    const why = "// timing: the hold lasts two seconds.\nawait act(() => Bun.sleep(2300));";
    expect(uncommentedActSleeps(why)).toBe(0);
    expect(uncommentedActSleeps("// timing: x\n\nawait act(() => Bun.sleep(1));")).toBe(0);
    expect(uncommentedActSleeps("// some other comment\nawait act(() => Bun.sleep(1));")).toBe(1);
  });

  test("a settle, a stays or a sleep outside act is not a site", () => {
    expect(uncommentedActSleeps("await settle(() => ok());")).toBe(0);
    expect(uncommentedActSleeps("await stays(() => ok(), 100);")).toBe(0);
    expect(uncommentedActSleeps("await Bun.sleep(30);")).toBe(0);
  });

  test("it counts per file and skips the files that hold the shared waits", () => {
    const dir = realTempDir("act-sleep-");
    writeFileSync(resolve(dir, "a.test.tsx"), "await act(() => Bun.sleep(1));\n");
    writeFileSync(resolve(dir, "wait.ts"), "await act(() => Bun.sleep(1));\n");
    writeFileSync(resolve(dir, "ok.test.tsx"), "// timing: x\nawait act(() => Bun.sleep(1));\n");
    expect(actSleepCounts(dir, dir)).toEqual({ "a.test.tsx": 1 });
  });

  test("no desktop test has an act sleep without its reason", () => {
    expect(actSleepCounts(resolve(ROOT, "apps/desktop/test"), ROOT)).toEqual({});
  });
});
