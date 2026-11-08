import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { realpathSync } from "node:fs";
import { type FakeCli, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { runGhIn } from "../src/github/gh.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("runGhIn (issue #79)", () => {
  test("runs gh in the folder it is given, so the repo comes from that folder's remote", async () => {
    const fake: FakeCli = installFakeCli("gh", [{ args: ["api"], stdout: "[]" }]);
    cleanups.push(fake.restore);
    const folder = realpathSync.native(tempDir("fd-gh-in-"));
    const result = await runGhIn(["api", "repos/{owner}/{repo}/code-scanning/alerts"], folder);
    expect(result).toMatchObject({ code: 0, stdout: "[]" });
    expect(fake.calls()).toEqual([["api", "repos/{owner}/{repo}/code-scanning/alerts"]]);
    expect(fake.cwds().map((cwd) => realpathSync.native(cwd))).toEqual([folder]);
  });

  test("with no gh on the PATH it answers null, not an error", async () => {
    const before = process.env.PATH;
    process.env.PATH = realpathSync.native(tempDir("fd-no-gh-"));
    cleanups.push(() => {
      process.env.PATH = before;
    });
    expect(await runGhIn(["api", "x"], process.cwd())).toBeNull();
  });
});
