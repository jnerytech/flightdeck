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
  test("a file with a known Sonar issue fails and names rule and line", () => {
    const { code, out } = lint("flagged.ts");
    expect(code).toBe(1);
    expect(out).toContain("flagged.ts:3  sonarjs/no-all-duplicated-branches");
  });

  test("the same issue with a NOSONAR and a reason passes", () => {
    const { code, out } = lint("suppressed.ts");
    expect(out).toContain("lint:sonar: no findings");
    expect(code).toBe(0);
  });

  test("a NOSONAR with no reason fails", () => {
    const { code, out } = lint("bare.ts");
    expect(code).toBe(1);
    expect(out).toContain("bare.ts:3  nosonar-reason");
  });
});
