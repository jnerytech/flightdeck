import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../src/board/command.ts";
import { FlightdeckError } from "../src/errors.ts";
import { FolderLocks } from "../src/worktrees/locks.ts";
import { type WorktreeCard, Worktrees, type WorktreesOptions } from "../src/worktrees/worktrees.ts";
import { git, gitRepo, gitRepoWithOrigin, newBoard } from "./board-helpers.ts";
import { newManager } from "./helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

const DAY = 86_400_000;
const MB = 1024 * 1024;
const ID = ["-c", "user.email=a@b", "-c", "user.name=t"];

interface Setup {
  repo: string;
  add(name: string, branch?: string): string;
  worktrees: Worktrees;
  options: WorktreesOptions;
  locks: FolderLocks;
}

function setup(
  over: Partial<WorktreesOptions> = {},
  where: { repo: string } = gitRepo(),
  baseBranch = "main",
  cards: WorktreeCard[] = [],
): Setup {
  const { repo } = where;
  const locks = new FolderLocks();
  const add = (name: string, branch = `fd/${name}`) => {
    const path = join(repo, ".flightdeck", "worktrees", name);
    git(repo, "worktree", "add", "-q", "-b", branch, path, "main");
    return path;
  };
  const options: WorktreesOptions = {
    projects: () => [{ id: "p1", name: "api", path: repo, baseBranch }],
    cards: () => cards,
    busy: () => null,
    detach: () => {},
    git: (cwd, ...args) => run(cwd, ...args),
    size: async () => 5 * MB,
    disk: async () => null,
    now: () => Date.now() + 10 * DAY,
    locks,
    ...over,
  };
  return { repo, add, worktrees: new Worktrees(options), options, locks };
}

const commitIn = (dir: string, file: string) => {
  writeFileSync(join(dir, file), "work");
  git(dir, "add", file);
  git(dir, ...ID, "commit", "-q", "-m", file);
};
const branches = (repo: string) => git(repo, "branch", "--list", "fd/*");
const blockersOf = async (s: Setup) =>
  Object.fromEntries((await s.worktrees.list()).worktrees.map((w) => [w.branch, w.blockers]));

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

describe("worktrees-seguranca: nothing starts in a folder being removed (F4)", () => {
  test("the folder is held while it is removed, released after, and released after a failure too", async () => {
    const where = gitRepo();
    const seen: boolean[] = [];
    let s: Setup;
    s = setup(
      {
        git: (cwd, ...args) => {
          if (args.includes("remove"))
            seen.push(s.locks.isHeld(join(cwd, ".flightdeck", "worktrees", "a")));
          return run(cwd, ...args);
        },
      },
      where,
    );
    const path = s.add("a");
    await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(seen).toEqual([true]);
    expect(s.locks.isHeld(path)).toBe(false);
    const broken = setup(
      {
        git: (cwd, ...args) =>
          args.includes("remove") ? Promise.reject(new Error("spawn failed")) : run(cwd, ...args),
      },
      where,
    );
    const other = broken.add("b");
    const result = await broken.worktrees.remove([{ projectId: "p1", path: other }]);
    expect(result.kept).toEqual([{ path: other, reason: "failed", detail: "spawn failed" }]);
    expect(broken.locks.isHeld(other)).toBe(false);
  });

  test("a held folder covers what is inside it, and not its neighbours", () => {
    const locks = new FolderLocks();
    locks.hold("/w/.flightdeck/worktrees/a");
    expect(locks.isHeld("/w/.flightdeck/worktrees/a")).toBe(true);
    expect(locks.isHeld("/w/.flightdeck/worktrees/a/src")).toBe(true);
    expect(locks.isHeld("/w/.flightdeck/worktrees/ab")).toBe(false);
    expect(locks.isHeld("/w/.flightdeck/worktrees")).toBe(false);
    locks.release("/w/.flightdeck/worktrees/a");
    expect(locks.isHeld("/w/.flightdeck/worktrees/a/src")).toBe(false);
  });

  test("a session, a terminal and a card cannot start in a held folder", async () => {
    const locks = new FolderLocks();
    const { manager, project } = newManager({ folderLocks: locks });
    locks.hold(project);
    await expect(manager.create({ cwd: project, prompt: "hi" })).rejects.toMatchObject({
      reason: "folder_removing",
    });
    const { TerminalManager } = await import("../src/terminal/terminal-manager.ts");
    const terminals = new TerminalManager({
      pty: fakePtys().factory,
      allowedRoots: [project],
      folderLocks: locks,
    });
    await expect(
      terminals.open({ cwd: project, cols: 80, rows: 24 } as never),
    ).rejects.toMatchObject({
      reason: "folder_removing",
    });
    locks.release(project);
    await manager.create({ cwd: project, prompt: "hi" });
    expect(FlightdeckError).toBeDefined();
  });

  test("a card cannot start in a held worktree", async () => {
    const locks = new FolderLocks();
    const ctx = newBoard({ folderLocks: locks });
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    const path = join(ctx.repo, ".flightdeck", "worktrees", "one");
    git(ctx.repo, "worktree", "add", "-q", "-b", "fd/one", path, "main");
    ctx.store.db
      .query("UPDATE cards SET worktree_path = ?, branch = 'fd/one' WHERE id = ?")
      .run(path, card.id);
    locks.hold(path);
    await ctx.board.startCard(card.id).catch(() => {});
    await Bun.sleep(50);
    expect(ctx.board.getCard(card.id).sessionId).toBeNull();
    ctx.board.stop();
  });

  test("two removals of the same folder at once remove it once", async () => {
    const s = setup();
    const path = s.add("twice");
    const [a, b] = await Promise.all([
      s.worktrees.remove([{ projectId: "p1", path }]),
      s.worktrees.remove([{ projectId: "p1", path }]),
    ]);
    expect(a.removed.length + b.removed.length).toBe(1);
  });

  test("the size is read before the last look, so a change during it is seen", async () => {
    const s = setup();
    const path = s.add("busy");
    const w = new Worktrees({
      ...s.options,
      size: async (p) => {
        writeFileSync(join(p, "typed-during-du.txt"), "x");
        return 1;
      },
    });
    const result = await w.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([]);
    expect(result.kept[0]).toMatchObject({ reason: "dirty" });
    expect(existsSync(join(path, "typed-during-du.txt"))).toBe(true);
  });

  test("one item that throws does not drop the others or the result", async () => {
    const s = setup();
    const bad = s.add("bad");
    const good = s.add("good");
    const w = new Worktrees({
      ...s.options,
      busy: (p) => {
        if (p === bad) throw new Error("busy exploded");
        return null;
      },
    });
    const result = await w.remove([
      { projectId: "p1", path: bad },
      { projectId: "p1", path: good },
    ]);
    expect(result.kept).toEqual([{ path: bad, reason: "failed", detail: "busy exploded" }]);
    expect(result.removed.map((r) => r.path)).toEqual([good]);
  });
});

describe("worktrees-seguranca: files git does not show are not lost (F5)", () => {
  function withIgnore() {
    const where = gitRepo();
    writeFileSync(join(where.repo, ".gitignore"), "node_modules/\nnotes.local\n.env\n");
    git(where.repo, "add", ".gitignore");
    git(where.repo, ...ID, "commit", "-q", "-m", "ignore");
    return where;
  }

  test("an untracked file counts even when git is set not to show untracked files", async () => {
    const where = gitRepo();
    git(where.repo, "config", "status.showUntrackedFiles", "no");
    const s = setup({}, where);
    const path = s.add("x");
    writeFileSync(join(path, "scratch.txt"), "x");
    expect((await blockersOf(s))["fd/x"]).toContain("dirty");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(path, "scratch.txt"))).toBe(true);
  });

  test("an ignored file that is not rebuildable keeps the worktree; node_modules does not", async () => {
    const where = withIgnore();
    const s = setup({}, where);
    const mods = s.add("mods");
    mkdirSync(join(mods, "node_modules"));
    writeFileSync(join(mods, "node_modules", "x.js"), "x");
    const notes = s.add("notes");
    writeFileSync(join(notes, "notes.local"), "my notes");
    const env = s.add("env");
    writeFileSync(join(env, ".env"), "KEY=1");
    const by = await blockersOf(s);
    expect(by["fd/mods"]).toEqual([]);
    expect(by["fd/notes"]).toEqual(["ignored_files"]);
    expect(by["fd/env"]).toEqual(["ignored_files"]);
    const result = await s.worktrees.remove([{ projectId: "p1", path: notes }]);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(notes, "notes.local"))).toBe(true);
  });

  test("the removal asks git to look at untracked files whatever the config says", async () => {
    const calls: string[][] = [];
    const s = setup({
      git: (cwd, ...args) => {
        calls.push(args);
        return run(cwd, ...args);
      },
    });
    const path = s.add("x");
    await s.worktrees.remove([{ projectId: "p1", path }]);
    const removal = calls.find((a) => a.includes("remove"));
    expect(removal?.slice(0, 2)).toEqual(["-c", "status.showUntrackedFiles=all"]);
    expect(calls.find((a) => a.includes("status"))).toContain("--untracked-files=all");
  });
});

describe("worktrees-seguranca: the guards the review found untested", () => {
  test("a worktree that git lists but is a link is not ours", async () => {
    const s = setup();
    const real = s.add("real");
    const moved = `${real}-moved`;
    renameSync(real, moved);
    symlinkSync(moved, real);
    expect((await s.worktrees.list()).worktrees).toEqual([]);
    expect((await s.worktrees.remove([{ projectId: "p1", path: real }])).removed).toEqual([]);
    expect(existsSync(moved)).toBe(true);
  });

  test("a running or unknown-base worktree is also refused through remove, and a session of any live state holds it", async () => {
    const s = setup({ busy: () => "running" });
    const path = s.add("r");
    expect((await s.worktrees.remove([{ projectId: "p1", path }])).kept[0]?.reason).toBe("running");
    const t = setup({}, gitRepo(), "nope");
    const other = t.add("u");
    expect((await t.worktrees.remove([{ projectId: "p1", path: other }])).kept[0]?.reason).toBe(
      "unknown_base",
    );
  });
});

describe("worktrees-seguranca: the card keeps a truthful record (F6)", () => {
  test("releasing frees only the worktree that was removed, and drops the branch that is gone", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    ctx.store.db
      .query("UPDATE cards SET worktree_path = '/a', branch = 'fd/a' WHERE id = ?")
      .run(card.id);
    ctx.board.releaseWorktree(card.id, "/b", true);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: "/a", branch: "fd/a" });
    ctx.board.releaseWorktree(card.id, "/a", false);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: null, branch: "fd/a" });
    ctx.store.db.query("UPDATE cards SET worktree_path = '/a' WHERE id = ?").run(card.id);
    ctx.board.releaseWorktree(card.id, "/a", true);
    expect(ctx.board.getCard(card.id)).toMatchObject({ worktreePath: null, branch: null });
  });

  test("a card whose worktree the panel removed can still be discarded", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    ctx.store.db
      .query("UPDATE cards SET worktree_path = '/a', branch = 'fd/gone' WHERE id = ?")
      .run(card.id);
    ctx.board.releaseWorktree(card.id, "/a", true);
    await ctx.board.discardCard(card.id, true);
    ctx.board.stop();
  });

  test("a card in a run is active, an idle one is not", async () => {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    expect(ctx.board.isActive(card.id)).toBe(false);
    await ctx.board.startCard(card.id);
    expect(ctx.board.isActive(card.id)).toBe(true);
    ctx.board.stop();
  });
});
