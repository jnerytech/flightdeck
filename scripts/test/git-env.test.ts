import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_ENV_VARS, installGitEnvGuard, scrubGitEnv } from "./git-env.ts";
import { realTempDir } from "./temp-dir.ts";

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
}

describe("isolamento: git variables of the caller do not reach the tests", () => {
  test("every variable that redirects git is removed, and the names that were set are returned", () => {
    const env: Record<string, string | undefined> = { PATH: "/bin", GIT_AUTHOR_NAME: "keep" };
    for (const name of GIT_ENV_VARS) env[name] = "/somewhere";
    expect(scrubGitEnv(env).sort()).toEqual([...GIT_ENV_VARS].sort());
    for (const name of GIT_ENV_VARS) expect(env[name]).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_AUTHOR_NAME).toBe("keep");
    expect(scrubGitEnv(env)).toEqual([]);
  });

  test("a process that inherited GIT_DIR runs git init --bare without touching that repository", () => {
    const real = realTempDir("fd-git-env-real-");
    git(real, "init", "-q", "-b", "main");
    const configPath = join(real, ".git", "config");
    const before = readFileSync(configPath, "utf8");
    const elsewhere = realTempDir("fd-git-env-remote-");
    const probe = Bun.spawnSync(["bun", join(import.meta.dir, "git-env-probe.ts"), elsewhere], {
      env: { ...process.env, GIT_DIR: join(real, ".git") },
      stderr: "pipe",
    });
    expect(probe.stderr.toString()).toBe("");
    expect(probe.exitCode).toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(before).not.toContain("bare = true");
    // The bare repository went where the folder is, not where GIT_DIR pointed.
    expect(readFileSync(join(elsewhere, "config"), "utf8")).toContain("bare = true");
  });

  test("installing the guard reports the variables it removed from the process", () => {
    const saved = process.env.GIT_WORK_TREE;
    process.env.GIT_WORK_TREE = "/somewhere";
    try {
      expect(installGitEnvGuard().removed).toContain("GIT_WORK_TREE");
      expect(process.env.GIT_WORK_TREE).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = saved;
    }
  });
});
