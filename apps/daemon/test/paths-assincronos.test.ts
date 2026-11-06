import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listDirs, listFiles } from "../src/fs-dirs.ts";
import { resolveAllowedCwd } from "../src/paths.ts";
import { isSystemFolder } from "../src/roots.ts";
import { resolveSshPath } from "../src/ssh/connect.ts";
import { tempDir } from "./helpers.ts";

/** The path and folder checks do their file system work without blocking: each one answers with a promise. */
describe("path checks answer asynchronously", () => {
  const root = realpathSync.native(tempDir("fd-async-paths-"));
  mkdirSync(join(root, "code"), { recursive: true });
  writeFileSync(join(root, "code", "a.txt"), "x");

  test("resolveAllowedCwd, listDirs and listFiles return promises that settle to the same answers", async () => {
    const cwd = resolveAllowedCwd(join(root, "code"), [root]);
    expect(cwd).toBeInstanceOf(Promise);
    expect(await cwd).toBe(join(root, "code"));
    const dirs = listDirs(root, [root]);
    expect(dirs).toBeInstanceOf(Promise);
    expect((await dirs).dirs.map((d) => d.name)).toEqual(["code"]);
    const files = listFiles(join(root, "code"), [root]);
    expect(files).toBeInstanceOf(Promise);
    expect((await files).files.map((f) => f.name)).toEqual(["a.txt"]);
  });

  test("a refusal is a rejection, not a throw", async () => {
    let thrown: unknown;
    let pending: unknown;
    try {
      pending = resolveAllowedCwd("/tmp", [root]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    await expect(pending).rejects.toMatchObject({ code: "forbidden_cwd" });
  });

  test("isSystemFolder and resolveSshPath answer with promises and take an async exists", async () => {
    const info = { platform: "linux" as const, env: {}, home: "/home/dev" };
    const system = isSystemFolder("/etc", info);
    expect(system).toBeInstanceOf(Promise);
    expect(await system).toBe(true);
    const ssh = resolveSshPath({
      platform: "win32",
      exists: async () => true,
      which: () => null,
    });
    expect(ssh).toBeInstanceOf(Promise);
    expect(await ssh).toContain("OpenSSH");
  });
});
