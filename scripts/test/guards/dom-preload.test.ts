import { describe, expect, test } from "bun:test";
import { runsDesktopTests } from "../happy-dom.ts";

/** #2006: which runs get the DOM before their first test file loads. */
describe("happy-dom preload: which runs include desktop tests", () => {
  const bun = "/home/u/.bun/bin/bun";

  test("a run with no path is the whole suite, and has desktop tests", () => {
    expect(runsDesktopTests([bun])).toBe(true);
  });

  test("a path in apps/desktop is a desktop run, on either kind of slash", () => {
    expect(runsDesktopTests([bun, "/r/apps/desktop/test/a.test.ts"])).toBe(true);
    expect(runsDesktopTests([bun, "C:\\r\\apps\\desktop\\test\\a.test.ts"])).toBe(true);
    expect(
      runsDesktopTests([bun, "/r/apps/daemon/test/a.test.ts", "/r/apps/desktop/test/b.test.tsx"]),
    ).toBe(true);
  });

  test("paths that are all elsewhere are not, so a daemon or scripts run keeps its own globals", () => {
    expect(
      runsDesktopTests([bun, "/r/apps/daemon/test/a.test.ts", "/r/scripts/test/b.test.ts"]),
    ).toBe(false);
    expect(runsDesktopTests([bun, "/r/packages/protocol/test/a.test.ts"])).toBe(false);
  });
});
