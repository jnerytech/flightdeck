import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

interface Override {
  includes: string[];
  linter?: { rules?: { nursery?: Record<string, string> } };
}

describe("lint-floating-promises: a promise nobody awaits is a lint error", () => {
  const config = JSON.parse(readFileSync(resolve(ROOT, "biome.json"), "utf8")) as {
    overrides: Override[];
  };
  const covered = (glob: string) =>
    config.overrides.some(
      (o) => o.includes.includes(glob) && o.linter?.rules?.nursery?.noFloatingPromises === "error",
    );

  test("Biome's noFloatingPromises is an error for apps/ and scripts/", () => {
    expect(covered("apps/**")).toBe(true);
    expect(covered("scripts/**")).toBe(true);
  });

  test("docs/TDD.md tells how to write a call that is meant to be left alone", () => {
    const tdd = readFileSync(resolve(ROOT, "docs/TDD.md"), "utf8");
    expect(tdd).toContain("noFloatingPromises");
  });
});
