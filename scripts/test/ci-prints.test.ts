import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** #291: the prints and axe run in four jobs, one per theme and language, under the one screenshots check. */
const ROOT = resolve(import.meta.dir, "../..");

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown[]> };
  steps: Step[];
}
const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const prints = ci.jobs["screenshots-prints"] ?? { steps: [] };

describe("ci-prints (#291)", () => {
  test("the prints job is a matrix of the two themes and the two languages, none cancelling the others", () => {
    expect(prints.strategy?.matrix).toEqual({ theme: ["light", "dark"], lang: ["pt-BR", "en"] });
    expect(prints.strategy?.["fail-fast"]).toBe(false);
    expect(prints.name).toBe("prints and axe ${{ matrix.theme }} ${{ matrix.lang }}");
  });

  test("each job prints its own pair, and keeps its prints in an artifact of its own", () => {
    const shots = prints.steps.find((s) => (s.run ?? "").includes("bun run demo:shots"));
    expect(shots?.env).toEqual({
      VISUAL: "record",
      SHOTS_THEME: "${{ matrix.theme }}",
      SHOTS_LANG: "${{ matrix.lang }}",
    });
    const upload = prints.steps.find((s) => (s.uses ?? "").startsWith("actions/upload-artifact@"));
    expect(upload?.with?.name).toBe("prints-${{ matrix.theme }}-${{ matrix.lang }}");
  });

  test("the takeShots loop goes through shotVariants, and refuses a filter that keeps nothing", () => {
    const source = readFileSync(join(ROOT, "scripts/demo-shots.ts"), "utf8");
    expect(source).toContain("shotVariants(process.env)");
    expect(source).toContain("no theme and language pair matches SHOTS_THEME");
  });
});
