import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const BDD = join(ROOT, "scripts/e2e/bdd");

/** Every file under `dir`, as paths from the repo root. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(ROOT, path)];
  });
}
const files = walk(BDD);
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("bdd-guard: one English feature per behaviour, run in both app languages (issue #131)", () => {
  test("there is no Portuguese twin of a feature: the app language is a run parameter, not a file", () => {
    expect(files.filter((f) => /\.pt(-BR)?\.feature$/i.test(f))).toEqual([]);
    for (const feature of files.filter((f) => f.endsWith(".feature"))) {
      expect(read(feature)).not.toMatch(/^\s*#\s*language:\s*(?!en\b)/m);
    }
  });

  test("a feature file is named for its behaviour, with no language in its name", () => {
    expect(files.filter((f) => /\.(en|pt)\.feature$/.test(f))).toEqual([]);
  });

  test("the steps are written once, in English, and find elements by role and dictionary key", () => {
    const steps = read("scripts/e2e/bdd/steps.ts")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // The old way: every step registered under a Portuguese and an English wording.
    expect(steps).not.toMatch(/\bboth\(/);
    expect(steps).not.toMatch(/\bpt:\s*["'`]/);
    // Literal UI text (the dictionary has it, in the language of the run): by text, label or name.
    expect(steps).not.toMatch(/get(ByText|ByLabel|ByPlaceholder|ByTitle)\(\s*["'`]/);
    expect(steps).not.toMatch(/getByRole\([^)]*\bname:\s*["'`]/);
    // No accented letter in a step or a feature: the repo's text is English.
    expect(steps).not.toMatch(/[À-ÿ]/);
    for (const feature of files.filter((f) => f.endsWith(".feature"))) {
      expect(read(feature)).not.toMatch(/[À-ÿ]/);
    }
  });
});
