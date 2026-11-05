import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    ["an await inside a loop fails (Sonar S9382)", "awaits.ts", 1, "awaits.ts:5  no-await-in-loop"],
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

  describe("--ratchet", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-sonar-"));
    const baseline = join(dir, "baseline.json");
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const ratchet = (fixture: string, ...extra: string[]) => {
      const proc = Bun.spawnSync(
        [
          process.execPath,
          "run",
          "tools/sonar-lint/run.ts",
          "--ratchet",
          "--baseline",
          baseline,
          ...extra,
          "--files",
          `tools/sonar-lint/fixtures/${fixture}`,
        ],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
      );
      return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
    };
    const rule = "sonarjs/no-all-duplicated-branches";

    test("--init writes the counts once, and a second --init is refused", () => {
      expect(ratchet("flagged.ts", "--init").code).toBe(0);
      expect(JSON.parse(readFileSync(baseline, "utf8"))).toEqual({ [rule]: 1 });
      const again = ratchet("flagged.ts", "--init");
      expect(again.code).toBe(1);
      expect(again.out).toContain("already has entries");
    });

    test("the same findings pass, more findings than the baseline allows fail", () => {
      expect(ratchet("flagged.ts").code).toBe(0);
      writeFileSync(baseline, "{}\n");
      const over = ratchet("flagged.ts");
      expect(over.code).toBe(1);
      expect(over.out).toContain(`${rule}: 1 > 0`);
    });

    test("--write lowers the baseline to today's counts and never raises it", () => {
      writeFileSync(baseline, JSON.stringify({ [rule]: 3, "sonarjs/other": 2 }));
      expect(ratchet("flagged.ts", "--write").code).toBe(0);
      expect(JSON.parse(readFileSync(baseline, "utf8"))).toEqual({ [rule]: 1 });
    });
  });
});
