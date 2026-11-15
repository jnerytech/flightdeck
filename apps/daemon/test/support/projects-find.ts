import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../src/projects/project-find.ts";
import { tempDir } from "./helpers.ts";

/** A root with repos at several depths, plus things a scan must not enter or follow. */
export function tree() {
  const base = realpathSync.native(tempDir("fd-find-"));
  const root = join(base, "code");
  for (const dir of [
    "app/.git",
    "group/lib/.git",
    "group/deep/er/too/.git",
    "plain/notes",
    "node_modules/pkg/.git",
    ".hidden/repo/.git",
    "app/packages/inner/.git",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  // A worktree keeps `.git` as a file.
  mkdirSync(join(root, "wt"));
  writeFileSync(join(root, "wt", ".git"), "gitdir: /elsewhere");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "stolen/.git"), { recursive: true });
  symlinkSync(join(outside, "stolen"), join(root, "link"));
  return { base, root, outside };
}

/** A git that creates the folder it was asked to clone into, and remembers its arguments. */
export function fakeGit(code = 0, stderr = "") {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    if (code === 0) mkdirSync(args[args.length - 1] as string, { recursive: true });
    return { code, stderr };
  };
  return { git, calls };
}
