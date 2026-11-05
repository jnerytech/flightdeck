import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** Runs `bun run lint:sonar` on fixture files, without type information to stay fast. */
function lint(...fixtures: string[]) {
  const proc = Bun.spawnSync(
    [
      process.execPath,
      "run",
      "tools/sonar-lint/run.ts",
      "--no-types",
      "--files",
      ...fixtures.map((f) => `tools/sonar-lint/fixtures/${f}`),
    ],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  return { code: proc.exitCode, out: proc.stdout.toString() };
}

describe("lint:sonar", () => {
  test.each([
    [
      "a file with a known Sonar issue fails and names rule and line",
      "flagged.ts",
      1,
      "flagged.ts:3  sonarjs/no-all-duplicated-branches",
    ],
    [
      "the same issue with a NOSONAR and a reason passes",
      "suppressed.ts",
      0,
      "lint:sonar: no findings",
    ],
    ["a NOSONAR with no reason fails", "bare.ts", 1, "bare.ts:3  nosonar-reason"],
  ])("%s", (_title, fixture, code, line) => {
    const result = lint(fixture);
    expect(result.code).toBe(code);
    expect(result.out).toContain(line);
  });

  test("test code gets the test rules: a skipped test fails", () => {
    const { code, out } = lint("test/skipped.fixture.ts");
    expect(code).toBe(1);
    expect(out).toContain("skipped.fixture.ts:4  sonarjs/no-skipped-tests");
  });

  test("test code with a suppressed finding passes", () => {
    expect(lint("test/suppressed.fixture.ts").code).toBe(0);
  });

  test("source code does not get the test rules", () => {
    expect(lint("flagged.ts").out).not.toContain("no-skipped-tests");
  });
});
