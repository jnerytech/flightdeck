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
      inPlace?: boolean;
      tempDirName?: string;
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

  test("mutants run in a copy of the repo, never in place, in a folder git ignores", () => {
    const { inPlace, tempDirName, testRunner } = config();
    expect(testRunner).toBe("command");
    expect(inPlace ?? false).toBe(false);
    expect(read(".gitignore")).toContain(`${tempDirName}/`);
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

describe("weekly mutation run (#1607)", () => {
  const domains = () =>
    JSON.parse(read("mutation-domains.json")) as {
      name: string;
      mutate: string[];
      tests: string[];
    }[];
  const workflow = () => read(".github/workflows/mutation.yml");

  test("every domain has a unique name, files to mutate that exist and test files that exist", () => {
    const list = domains();
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((d) => d.name)).size).toBe(list.length);
    for (const { name, mutate, tests } of list) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(mutate.length, name).toBeGreaterThan(0);
      expect(tests.length, name).toBeGreaterThan(0);
      for (const file of [...mutate, ...tests])
        expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  test("`bun run mutation:weekly` is the entry the workflow runs", () => {
    expect(JSON.parse(read("package.json")).scripts["mutation:weekly"]).toBe(
      "bun run scripts/mutation-weekly.ts",
    );
    expect(workflow()).toContain("bun run mutation:weekly");
  });

  test("the workflow starts on a schedule or by hand, never on a push, a pull request or a release", () => {
    const on = workflow().match(/^on:\n((?:[ \t].*\n|\n)*)/m)?.[1] ?? "";
    expect(on).toContain("schedule:");
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(/pull_request|push:|release:|workflow_run/);
  });

  test("it only reads the repository, has a timeout, keeps the incremental state and uploads the JSON", () => {
    const text = workflow();
    expect(text).toMatch(/permissions:\n\s+contents: read/);
    expect(text).not.toMatch(/contents: write|pull-requests: write|issues: write/);
    expect(text).toMatch(/timeout-minutes: \d+/);
    expect(text).toContain("actions/cache@");
    expect(text).toContain("reports/mutation");
    expect(text).toContain("actions/upload-artifact@");
  });
});
