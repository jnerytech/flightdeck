import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// repo-wide (#1108): reads the Stryker config, the package scripts and the CI workflow.

const ROOT = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("mutation testing (#1607)", () => {
  const config = () =>
    JSON.parse(read("stryker.config.json")) as {
      mutate: string[];
      commandRunner: { command: string };
      testRunner: string;
    };

  test("every file it mutates exists, and the command runs a test file that exists", () => {
    expect(existsSync(join(ROOT, "stryker.config.json"))).toBe(true);
    const { mutate, commandRunner } = config();
    expect(mutate.length).toBeGreaterThan(0);
    for (const file of mutate) expect(existsSync(join(ROOT, file)), file).toBe(true);
    const tests = commandRunner.command.split(" ").filter((part) => part.endsWith(".test.ts"));
    expect(tests.length).toBeGreaterThan(0);
    for (const test of tests) expect(existsSync(join(ROOT, test)), test).toBe(true);
  });

  test("the run is by hand: `bun run mutation`, and no CI workflow starts it", () => {
    expect(JSON.parse(read("package.json")).scripts.mutation).toBe("stryker run");
    for (const workflow of ["ci.yml", "release.yml"]) {
      expect(read(`.github/workflows/${workflow}`), workflow).not.toMatch(
        /stryker|bun run mutation/,
      );
    }
  });

  test("Stryker is a devDependency pinned to one version", () => {
    const version = JSON.parse(read("package.json")).devDependencies["@stryker-mutator/core"];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
