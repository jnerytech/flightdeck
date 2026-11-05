import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "./temp-dir.ts";

const PRELOAD = join(import.meta.dir, "preload.ts");

/**
 * A test file that checks the globals are the real ones when it starts, then leaves them changed
 * the way a careless file does. Whichever of two such files runs second would fail without the
 * preload's reset between files.
 */
const FIXTURE = `
import { expect, test } from "bun:test";
test("starts with the real globals", () => {
  expect(process.env.ISOLATION_LEAK, "env").toBeUndefined();
  expect(globalThis.setTimeout.name, "setTimeout").not.toBe("leakedTimeout");
  expect(String(globalThis.fetch).includes("leakedFetch"), "fetch").toBe(false);
  expect(globalThis.Date.name, "Date").not.toBe("LeakedDate");
});
test("leaves them changed", () => {
  process.env.ISOLATION_LEAK = "yes";
  globalThis.setTimeout = Object.assign(function leakedTimeout() {}, globalThis.setTimeout) as never;
  Object.defineProperty(globalThis.setTimeout, "name", { value: "leakedTimeout" });
  globalThis.fetch = (async function leakedFetch() { return new Response(""); }) as never;
  globalThis.Date = class LeakedDate extends Date {} as never;
});
`;

describe("isolation: the preload puts the globals back between two test files", () => {
  test("a file that leaked a timer, fetch, Date and an env variable does not reach the file after it", async () => {
    const dir = realTempDir("fd-isolation-files-");
    writeFileSync(join(dir, "a.test.ts"), FIXTURE);
    writeFileSync(join(dir, "b.test.ts"), FIXTURE);
    const proc = Bun.spawn(
      [
        process.execPath,
        "test",
        "--preload",
        PRELOAD,
        join(dir, "a.test.ts"),
        join(dir, "b.test.ts"),
      ],
      { cwd: dir, env: { ...process.env, CLAUDECODE: "" }, stdout: "pipe", stderr: "pipe" },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const log = `${out}${err}`;
    expect(log).toContain("4 pass");
    expect(log).not.toContain("fail");
    expect(code).toBe(0);
  }, 60_000);
});
