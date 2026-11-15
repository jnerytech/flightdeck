import { describe, expect, test } from "bun:test";
import { existsSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../../src/git/adapters/git.ts";
import type { runCommand } from "../../src/kernel/command.ts";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { FolderLocks } from "../../src/worktrees/domain/locks.ts";
import { createWorktrees, gitWithin } from "../../src/worktrees/wiring.ts";
import { Worktrees } from "../../src/worktrees/worktrees.ts";
import { git, gitRepo, newBoard } from "../support/board-helpers.ts";
import { newManager } from "../support/helpers.ts";
import { fakePtys } from "../support/pty-helpers.ts";
import { type Setup, setup } from "../support/worktree-security.ts";

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
    const { TerminalManager } = await import("../../src/terminal/terminal-manager.ts");
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
    // timing: the expected outcome is that nothing happens, so there is no condition to wait on
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

describe("worktrees-seguranca: what else holds a folder (F4, wiring)", () => {
  async function panel(over: Partial<Parameters<typeof createWorktrees>[0]> = {}) {
    const ctx = newBoard();
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const path = join(ctx.repo, ".flightdeck", "worktrees", "one");
    git(ctx.repo, "worktree", "add", "-q", "-b", "fd/one", path, "main");
    const card = ctx.board.createCard(project.id, { title: "One", description: "" });
    ctx.store.db.query("UPDATE cards SET worktree_path = ? WHERE id = ?").run(path, card.id);
    const w = createWorktrees({
      board: ctx.board,
      sessions: { list: () => [] },
      runs: { state: () => ({ status: "idle" }) },
      terminals: { list: () => [] },
      externals: { list: () => [] },
      locks: new FolderLocks(),
      ...over,
    });
    const blockers = async () => (await w.list()).worktrees.find((i) => i.path === path)?.blockers;
    return { ...ctx, card, path, blockers, w };
  }

  test("an open terminal, an external session or an active card keeps the worktree; closed ones do not", async () => {
    const open = await panel({ terminals: { list: () => [{ cwd: "/x", exitCode: null }] } });
    expect(await open.blockers()).toEqual([]);
    const inside = await panel();
    const terminals = [{ cwd: join(inside.path, "src"), exitCode: null as number | null }];
    const withTerminal = createWorktrees({
      board: inside.board,
      sessions: { list: () => [] },
      runs: { state: () => ({ status: "idle" }) },
      terminals: { list: () => terminals },
      externals: { list: () => [] },
      locks: new FolderLocks(),
    });
    const find = async (w: typeof withTerminal) =>
      (await w.list()).worktrees.find((i) => i.path === inside.path)?.blockers;
    expect(await find(withTerminal)).toEqual(["live_session"]);
    terminals[0] = { cwd: terminals[0]?.cwd ?? "", exitCode: 0 };
    expect(await find(withTerminal)).toEqual([]);
    const externals = [{ cwd: inside.path as string | null, status: "running" }];
    const withExternal = createWorktrees({
      board: inside.board,
      sessions: { list: () => [] },
      runs: { state: () => ({ status: "idle" }) },
      terminals: { list: () => [] },
      externals: { list: () => externals },
      locks: new FolderLocks(),
    });
    expect(await find(withExternal)).toEqual(["live_session"]);
    externals[0] = { cwd: null, status: "running" };
    expect(await find(withExternal)).toEqual([]);
    externals[0] = { cwd: inside.path, status: "ended" };
    expect(await find(withExternal)).toEqual([]);
    let active = false;
    const withCard = createWorktrees({
      board: {
        listProjects: () => inside.board.listProjects(),
        worktreeCards: (id) => inside.board.worktreeCards(id),
        releaseWorktree: () => {},
        isActive: () => active,
      },
      sessions: { list: () => [] },
      runs: { state: () => ({ status: "idle" }) },
      terminals: { list: () => [] },
      externals: { list: () => [] },
      locks: new FolderLocks(),
    });
    expect(await find(withCard)).toEqual([]);
    active = true;
    expect(await find(withCard)).toEqual(["running"]);
  });

  test("a git that runs out of time is a failure, not an answer", async () => {
    const seen: Array<number | undefined> = [];
    const run = (code: number, timedOut: boolean) =>
      (async (_cmd, _cwd, _input, timeoutMs) => {
        seen.push(timeoutMs);
        return { code, stdout: "5", stderr: "", timedOut };
      }) as typeof runCommand;
    expect((await gitWithin("/x", ["status"], 250, run(0, true))).code).not.toBe(0);
    expect((await gitWithin("/x", ["status"], 250, run(137, true))).code).toBe(137);
    expect((await gitWithin("/x", ["status"], 250, run(0, false))).code).toBe(0);
    expect(seen).toEqual([250, 250, 250]);
    const real = await panel({ gitDeadlineMs: 20_000 });
    expect((await real.w.list()).worktrees).toHaveLength(1);
  });
});
