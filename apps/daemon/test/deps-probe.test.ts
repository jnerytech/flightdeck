import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { probeVersion } from "../src/deps/probe.ts";
import { tempDir } from "./helpers.ts";

const bun = (code: string) => [process.execPath, "-e", code];

describe("deps-probe: one failing program never fails the host's check (HD-M1)", () => {
  test("a program that answers gives its first line", async () => {
    expect(await probeVersion(bun('console.log("tool 1.2.3\\nsecond")'))).toBe("tool 1.2.3");
  });

  test("a program that exits non-zero gives null", async () => {
    expect(await probeVersion(bun("console.log('x'); process.exit(1)"))).toBeNull();
  });

  test("a program that cannot be started (missing, or its interpreter is gone) gives null instead of throwing", async () => {
    const nowhere = join(tempDir("fd-probe-"), "no-such-tool");
    expect(await probeVersion([nowhere, "--version"])).toBeNull();
  });

  test("a program that hangs is killed at the timeout and gives null", async () => {
    const started = Date.now();
    expect(await probeVersion(bun("setTimeout(() => {}, 30000)"), 300)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
