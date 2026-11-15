import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../../src/git/adapters/git.ts";
import { git, gitRepo, gitRepoWithOrigin } from "../support/board-helpers.ts";
import { blockersOf, branches, commitIn, ID, MB, setup } from "../support/worktree-security.ts";

describe("worktrees-seguranca: the base branch cannot hide unpushed work (F1)", () => {
  for (const base of ["HEAD", "@", "v1", "--help", "nope", "refs/tags/v1", "HEAD~1"]) {
    test(`a project whose base is ${JSON.stringify(base)} keeps a worktree with a commit nowhere else`, async () => {
      const where = gitRepo();
      git(where.repo, "tag", "v1");
      const s = setup({}, where, base);
      const path = s.add("work");
      commitIn(path, "a.txt");
      expect((await blockersOf(s))["fd/work"]).toContain("unknown_base");
      const result = await s.worktrees.remove([{ projectId: "p1", path }]);
      expect(result.removed).toEqual([]);
      expect(existsSync(path)).toBe(true);
      expect(branches(where.repo)).toContain("fd/work");
    });
  }

  test("a worktree on the base branch itself is kept", async () => {
    const where = gitRepo();
    git(where.repo, "branch", "fd/base");
    const s = setup({}, where, "fd/base");
    const path = join(where.repo, ".flightdeck", "worktrees", "base");
    git(where.repo, "worktree", "add", "-q", path, "fd/base");
    expect((await blockersOf(s))["fd/base"]).toContain("unknown_base");
  });

  test("work pushed to a remote is not unpushed, and work only here is", async () => {
    const where = gitRepoWithOrigin();
    const s = setup({}, where);
    const pushed = s.add("pushed");
    commitIn(pushed, "p.txt");
    git(pushed, "push", "-q", "origin", "fd/pushed");
    const local = s.add("local");
    commitIn(local, "l.txt");
    const list = Object.fromEntries((await s.worktrees.list()).worktrees.map((w) => [w.branch, w]));
    expect(list["fd/pushed"]).toMatchObject({ unpushed: 0, blockers: [] });
    expect(list["fd/local"]).toMatchObject({ unpushed: 1, blockers: ["unpushed"] });
  });
});

describe("worktrees-seguranca: when git cannot say, nothing is removed (F2)", () => {
  const failing =
    (what: string, answer = { code: 128, stdout: "", stderr: "fatal" }) =>
    (cwd: string, ...args: string[]) =>
      args.includes(what) ? Promise.resolve(answer) : run(cwd, ...args);

  test("a rev-list that fails, answers nonsense or nothing is a blocker, never zero", async () => {
    for (const answer of [
      { code: 128, stdout: "", stderr: "fatal" },
      { code: 0, stdout: "banana\n", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
      { code: 0, stdout: "-3\n", stderr: "" },
    ]) {
      const s = setup({ git: failing("rev-list", answer) });
      const path = s.add("x");
      expect((await blockersOf(s))["fd/x"]).toContain("unknown_state");
      expect((await s.worktrees.remove([{ projectId: "p1", path }])).removed).toEqual([]);
      expect(existsSync(path)).toBe(true);
    }
  });

  test("a log that fails is a blocker too, and a status that fails counts as dirty", async () => {
    const a = setup({ git: failing("log") });
    a.add("x");
    expect((await blockersOf(a))["fd/x"]).toContain("unknown_state");
    const b = setup({ git: failing("status") });
    b.add("y");
    expect((await blockersOf(b))["fd/y"]).toContain("dirty");
  });
});

describe("worktrees-seguranca: the branch goes only if it is still what was checked (F3)", () => {
  test("a commit made after the check keeps the branch, and the folder still goes", async () => {
    const where = gitRepo();
    let moved = false;
    const s = setup(
      {
        git: async (cwd, ...args) => {
          const out = await run(cwd, ...args);
          // Right after the folder is removed, something commits to the branch from elsewhere.
          if (args.includes("worktree") && args.includes("remove") && !moved) {
            moved = true;
            const tree = git(where.repo, "rev-parse", "main^{tree}").trim();
            const parent = git(where.repo, "rev-parse", "fd/late").trim();
            const sha = git(
              where.repo,
              ...ID,
              "commit-tree",
              tree,
              "-p",
              parent,
              "-m",
              "late",
            ).trim();
            git(where.repo, "update-ref", "refs/heads/fd/late", sha);
          }
          return out;
        },
      },
      where,
    );
    const path = s.add("late");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([{ path, freedBytes: 5 * MB, branchKept: true }]);
    expect(existsSync(path)).toBe(false);
    expect(branches(where.repo)).toContain("fd/late");
  });

  test("a branch git refuses to delete is kept and said so, and a clean one goes with branchKept false", async () => {
    const where = gitRepo();
    const stuck = setup(
      {
        git: (cwd, ...args) =>
          args[0] === "update-ref" && args[1] === "-d"
            ? Promise.resolve({ code: 1, stdout: "", stderr: "locked" })
            : run(cwd, ...args),
      },
      where,
    );
    const path = stuck.add("stuck");
    const result = await stuck.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed[0]).toMatchObject({ path, branchKept: true });
    const clean = setup({}, where);
    const other = clean.add("clean");
    const done = await clean.worktrees.remove([{ projectId: "p1", path: other }]);
    expect(done.removed[0]).toMatchObject({ path: other, branchKept: false });
    expect(branches(where.repo)).not.toContain("fd/clean");
  });

  test("a worktree on a detached HEAD has no branch of ours: it is kept whole", async () => {
    const where = gitRepo();
    const s = setup({}, where);
    const path = join(where.repo, ".flightdeck", "worktrees", "loose");
    git(where.repo, "worktree", "add", "-q", "--detach", path, "main");
    const listed = (await s.worktrees.list()).worktrees.find((w) => w.path === path);
    expect(listed?.branch).toBeNull();
    expect(listed?.blockers).toContain("other_branch");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  test("only Flightdeck's own branches are deleted: a worktree on another branch is kept whole", async () => {
    const where = gitRepo();
    const s = setup({}, where);
    const path = s.add("odd", "feature/odd");
    expect((await blockersOf(s))["feature/odd"]).toContain("other_branch");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(path)).toBe(true);
    expect(git(where.repo, "branch", "--list", "feature/odd")).toContain("feature/odd");
  });
});
