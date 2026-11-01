import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPathUntouched, assertRepoUntouched, installRepoGuard } from "./repo-guard.ts";
import { realTempDir } from "./temp-dir.ts";

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
}

function repo(dirty = false) {
  const root = realTempDir("fd-repo-guard-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "first");
  if (dirty) writeFileSync(join(root, "wip.txt"), "work in progress\n");
  return root;
}

describe("isolamento: a test must not write into the repository", () => {
  test("nothing changed: quiet, even when the tree was already dirty", () => {
    const root = repo(true);
    const guard = installRepoGuard(root);
    expect(() => assertRepoUntouched(guard)).not.toThrow();
  });

  test("an untracked file, a changed tracked file or a new commit is reported, naming what changed", () => {
    const untracked = repo();
    const a = installRepoGuard(untracked);
    writeFileSync(join(untracked, "solto.txt"), "x\n");
    expect(() => assertRepoUntouched(a)).toThrow(/a test wrote into the repository.*solto\.txt/s);

    const edited = repo();
    const b = installRepoGuard(edited);
    writeFileSync(join(edited, "a.txt"), "changed\n");
    expect(() => assertRepoUntouched(b)).toThrow(/a\.txt/);

    const committed = repo();
    const c = installRepoGuard(committed);
    mkdirSync(join(committed, "sub"));
    writeFileSync(join(committed, "sub", "novo.txt"), "n\n");
    git(committed, "add", ".");
    git(committed, "commit", "-q", "-m", "arquivo novo");
    expect(() => assertRepoUntouched(c)).toThrow(/head/i);
  });

  test("a folder that is not a repository has nothing to guard", () => {
    const loose = realTempDir("fd-repo-guard-none-");
    expect(installRepoGuard(loose)).toBeNull();
    expect(() => assertRepoUntouched(null)).not.toThrow();
  });

  test("PATH put back is quiet, and one a test left changed is reported", () => {
    expect(() => assertPathUntouched(process.env.PATH)).not.toThrow();
    expect(() => assertPathUntouched(`/somewhere/else:${process.env.PATH}`)).toThrow(
      /PATH.*changed/i,
    );
  });
});
