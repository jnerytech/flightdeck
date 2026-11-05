import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git as run } from "../src/board/command.ts";
import {
  duSize,
  type WorktreeCard,
  Worktrees,
  type WorktreesOptions,
} from "../src/worktrees/worktrees.ts";
import { git, gitRepo } from "./board-helpers.ts";

const DAY = 86_400_000;
const MB = 1024 * 1024;

/** A repository with `main`, and a way to add `fd/*` worktrees under `.flightdeck/worktrees`. */
function setup(over: Partial<WorktreesOptions> = {}, cards: WorktreeCard[] = []) {
  const { repo } = gitRepo();
  const add = (name: string) => {
    const path = join(repo, ".flightdeck", "worktrees", name);
    git(repo, "worktree", "add", "-q", "-b", `fd/${name}`, path, "main");
    return path;
  };
  const detached: string[] = [];
  const project = { id: "p1", name: "api", path: repo, baseBranch: "main" };
  const options: WorktreesOptions = {
    projects: () => [project],
    cards: () => cards,
    busy: () => null,
    detach: (id) => void detached.push(id),
    git: (cwd, ...args) => run(cwd, ...args),
    size: async () => 50 * MB,
    disk: async () => ({ totalBytes: 1000 * MB, freeBytes: 400 * MB }),
    // Ten days after the worktrees were made: past the 7-day idle mark.
    now: () => Date.now() + 10 * DAY,
    ...over,
  };
  return { repo, add, detached, worktrees: new Worktrees(options), options };
}

const card = (id: string, path: string | null, over: Partial<WorktreeCard> = {}): WorktreeCard => ({
  id,
  title: `Card ${id}`,
  column: "in_progress",
  worktreePath: path,
  updatedAt: new Date().toISOString(),
  prState: null,
  ...over,
});

describe("worktrees: what the cards leave on the disk (issue #152)", () => {
  test("only the worktrees under .flightdeck/worktrees are listed, never the main checkout or another one", async () => {
    const { repo, add, worktrees } = setup();
    add("one");
    git(repo, "worktree", "add", "-q", "-b", "other", join(repo, "..", "elsewhere"), "main");
    const { worktrees: list } = await worktrees.list();
    expect(list.map((w) => w.branch)).toEqual(["fd/one"]);
    expect(list[0]?.path).toBe(join(repo, ".flightdeck", "worktrees", "one"));
  });

  test("a clean worktree with no card, idle for over 7 days, is suggested", async () => {
    const { add, worktrees } = setup();
    add("old");
    const [item] = (await worktrees.list()).worktrees;
    expect(item).toMatchObject({
      projectId: "p1",
      projectName: "api",
      cardId: null,
      dirty: false,
      unpushed: 0,
      blockers: [],
      suggested: true,
      sizeBytes: 50 * MB,
    });
    expect(item?.idleDays).toBeGreaterThanOrEqual(9);
  });

  test("a recent one is not suggested, and a card in progress is not either", async () => {
    const recent = setup({ now: () => Date.now() + DAY });
    recent.add("new");
    expect((await recent.worktrees.list()).worktrees[0]?.suggested).toBe(false);
    const inProgress = setup();
    const path = inProgress.add("busy");
    const w = new Worktrees({
      ...inProgress.options,
      cards: () => [card("c1", path, { updatedAt: new Date(Date.now() + 10 * DAY).toISOString() })],
    });
    const [item] = (await w.list()).worktrees;
    expect(item).toMatchObject({ cardId: "c1", cardTitle: "Card c1", suggested: false });
  });

  test("a Done card, or a merged PR, makes it suggested once it is idle", async () => {
    for (const over of [{ column: "done" as const }, { prState: "merged" as const }]) {
      const s = setup();
      const path = s.add("fin");
      const old = new Date(Date.now() - 10 * DAY).toISOString();
      const w = new Worktrees({
        ...s.options,
        cards: () => [card("c1", path, { ...over, updatedAt: old })],
      });
      expect((await w.list()).worktrees[0]?.suggested).toBe(true);
    }
  });

  test("uncommitted changes, a commit nowhere else, a live session and a run each keep it", async () => {
    const s = setup();
    const dirty = s.add("dirty");
    writeFileSync(join(dirty, "scratch.txt"), "x");
    const ahead = s.add("ahead");
    writeFileSync(join(ahead, "work.txt"), "x");
    git(ahead, "add", "work.txt");
    git(ahead, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "work");
    const live = s.add("live");
    const running = s.add("running");
    const w = new Worktrees({
      ...s.options,
      busy: (path) => (path === live ? "live_session" : path === running ? "running" : null),
    });
    const by = Object.fromEntries((await w.list()).worktrees.map((i) => [i.branch, i]));
    expect(by["fd/dirty"]).toMatchObject({ dirty: true, blockers: ["dirty"], suggested: false });
    expect(by["fd/ahead"]).toMatchObject({ unpushed: 1, blockers: ["unpushed"], suggested: false });
    expect(by["fd/live"]?.blockers).toEqual(["live_session"]);
    expect(by["fd/running"]?.blockers).toEqual(["running"]);
  });

  test("a branch merged into the base has no commit that exists nowhere else", async () => {
    const s = setup();
    const path = s.add("merged");
    writeFileSync(join(path, "a.txt"), "x");
    git(path, "add", "a.txt");
    git(path, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "a");
    git(s.repo, "merge", "-q", "--ff-only", "fd/merged");
    expect((await s.worktrees.list()).worktrees[0]).toMatchObject({ unpushed: 0, suggested: true });
  });

  test("a project whose base branch is gone keeps everything: nothing can be compared", async () => {
    const s = setup();
    s.add("x");
    const w = new Worktrees({
      ...s.options,
      projects: () => [{ id: "p1", name: "api", path: s.repo, baseBranch: "nope" }],
    });
    expect((await w.list()).worktrees[0]).toMatchObject({
      blockers: ["unknown_base"],
      suggested: false,
    });
  });

  test("a size that cannot be told is null, never 0, and the list still comes", async () => {
    const s = setup({ size: async () => null });
    s.add("x");
    const { worktrees } = await s.worktrees.list();
    expect(worktrees[0]?.sizeBytes).toBeNull();
    expect(worktrees).toHaveLength(1);
  });

  test("the free space of each project's disk comes with the list, and a project can be asked alone", async () => {
    const s = setup();
    s.add("x");
    const result = await s.worktrees.list("p1");
    expect(result.disks).toEqual([{ projectId: "p1", totalBytes: 1000 * MB, freeBytes: 400 * MB }]);
    expect((await s.worktrees.list("other")).worktrees).toEqual([]);
  });
});

describe("worktrees: a project git or the disk cannot read", () => {
  test("git failing, or a project folder that is gone, lists nothing and does not throw", async () => {
    const s = setup();
    s.add("x");
    const failing = new Worktrees({
      ...s.options,
      git: async () => ({ code: 128, stdout: "", stderr: "not a repository" }),
    });
    expect((await failing.list()).worktrees).toEqual([]);
    const gone = new Worktrees({
      ...s.options,
      projects: () => [
        { id: "p1", name: "api", path: join(s.repo, "..", "missing"), baseBranch: "main" },
      ],
      git: async () => ({ code: 0, stdout: "worktree /x\n\n", stderr: "" }),
    });
    expect((await gone.list()).worktrees).toEqual([]);
  });

  test("a disk that cannot be read is left out of the list, and a worktree that vanished is not shown", async () => {
    const s = setup({ disk: async () => null });
    const path = s.add("x");
    expect((await s.worktrees.list()).disks).toEqual([]);
    const ghost = new Worktrees({
      ...s.options,
      git: async (cwd, ...args) =>
        args[0] === "worktree" && args[1] === "list"
          ? {
              code: 0,
              stdout: `worktree ${path}\n\nworktree ${join(s.repo, ".flightdeck", "worktrees", "ghost")}\n`,
              stderr: "",
            }
          : run(cwd, ...args),
    });
    expect((await ghost.list()).worktrees.map((w) => w.path)).toEqual([path]);
  });
});

describe("worktrees: removing the safe ones", () => {
  test("it removes the folder and the branch, reports the bytes freed and frees the card", async () => {
    const s = setup();
    const path = s.add("gone");
    const w = new Worktrees({ ...s.options, cards: () => [card("c1", path, { column: "done" })] });
    const result = await w.remove([{ projectId: "p1", path }]);
    expect(result.removed).toEqual([{ path, freedBytes: 50 * MB }]);
    expect(result.kept).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(git(s.repo, "branch", "--list", "fd/gone").trim()).toBe("");
    expect(s.detached).toEqual(["c1"]);
  });

  test("a dirty, unpushed, live or running one is kept, with the reason, and nothing of it is touched", async () => {
    const s = setup();
    const dirty = s.add("dirty");
    writeFileSync(join(dirty, "precious.txt"), "do not lose");
    const ahead = s.add("ahead");
    writeFileSync(join(ahead, "w.txt"), "x");
    git(ahead, "add", "w.txt");
    git(ahead, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-q", "-m", "w");
    const live = s.add("live");
    const w = new Worktrees({ ...s.options, busy: (p) => (p === live ? "live_session" : null) });
    const result = await w.remove([
      { projectId: "p1", path: dirty },
      { projectId: "p1", path: ahead },
      { projectId: "p1", path: live },
    ]);
    expect(result.removed).toEqual([]);
    expect(result.kept.map((k) => [k.path, k.reason])).toEqual([
      [dirty, "dirty"],
      [ahead, "unpushed"],
      [live, "live_session"],
    ]);
    expect(existsSync(join(dirty, "precious.txt"))).toBe(true);
    expect(git(s.repo, "branch", "--list", "fd/ahead").trim()).not.toBe("");
  });

  test("it looks again at removal: a worktree that became dirty after the list is kept", async () => {
    const s = setup();
    const path = s.add("late");
    const list = await s.worktrees.list();
    expect(list.worktrees[0]?.suggested).toBe(true);
    writeFileSync(join(path, "late.txt"), "typed after the list");
    const result = await s.worktrees.remove([{ projectId: "p1", path }]);
    expect(result.kept[0]).toMatchObject({ reason: "dirty" });
    expect(existsSync(join(path, "late.txt"))).toBe(true);
  });

  test("a path that is not one of the project's listed worktrees is refused: the repo, a stranger, a symlink, a parent", async () => {
    const s = setup();
    const real = s.add("real");
    const link = join(s.repo, ".flightdeck", "worktrees", "link");
    symlinkSync(real, link);
    const outside = join(s.repo, "..", "plain");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep.txt"), "x");
    const result = await s.worktrees.remove([
      { projectId: "p1", path: s.repo },
      { projectId: "p1", path: outside },
      { projectId: "p1", path: link },
      { projectId: "p1", path: join(s.repo, ".flightdeck", "worktrees") },
      { projectId: "nope", path: real },
    ]);
    expect(result.removed).toEqual([]);
    expect(result.kept.every((k) => k.reason === "not_listed")).toBe(true);
    expect(existsSync(join(outside, "keep.txt"))).toBe(true);
    expect(existsSync(real)).toBe(true);
  });

  test("one failure does not stop the others, and the freed total is only what went", async () => {
    const s = setup();
    const good = s.add("good");
    const bad = s.add("bad");
    const w = new Worktrees({
      ...s.options,
      git: async (cwd, ...args) =>
        args[0] === "worktree" && args[1] === "remove" && args[2] === bad
          ? { code: 1, stdout: "", stderr: "locked" }
          : run(cwd, ...args),
    });
    const result = await w.remove([
      { projectId: "p1", path: bad },
      { projectId: "p1", path: good },
    ]);
    expect(result.removed.map((r) => r.path)).toEqual([good]);
    expect(result.kept).toEqual([{ path: bad, reason: "failed", detail: "locked" }]);
  });
});

describe("worktrees: the size scan", () => {
  const ran =
    (out: Partial<{ code: number; stdout: string; timedOut: boolean }>) =>
    async (cmd: string[], cwd: string, timeoutMs: number) => {
      ran.last = { cmd, cwd, timeoutMs };
      return { code: 0, stdout: "", stderr: "", ...out };
    };
  ran.last = {} as { cmd?: string[]; cwd?: string; timeoutMs?: number };

  test("du answers kilobytes: the size is those bytes, asked with the deadline", async () => {
    expect(await duSize("/w/x", 5000, ran({ stdout: "2048\t/w/x\n" }))).toBe(2048 * 1024);
    expect(ran.last).toMatchObject({ timeoutMs: 5000 });
    expect(ran.last.cmd?.slice(-1)).toEqual(["/w/x"]);
  });

  test("a scan that ran out of time, failed or answered nonsense is null, not 0", async () => {
    expect(await duSize("/w/x", 5, ran({ timedOut: true, code: 143 }))).toBeNull();
    expect(await duSize("/w/x", 5, ran({ code: 1 }))).toBeNull();
    expect(await duSize("/w/x", 5, ran({ stdout: "banana" }))).toBeNull();
  });
});
