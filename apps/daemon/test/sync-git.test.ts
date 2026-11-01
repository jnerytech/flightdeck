import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { installSleepingGit, type SleepingGit } from "../../../scripts/test/sleeping-git.ts";
import { Board } from "../src/board/board.ts";
import { excludeLocalSettings, excludeLocalSettingsAsync } from "../src/board/worktree.ts";
import { ProjectKeys } from "../src/central/project-key.ts";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import { ProjectMemory } from "../src/memory/memory.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { git, gitRepo, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { writeUsageTranscript } from "./usage-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "sync-git-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
// A sleeping git left on PATH makes every later git call of the run sleep: each test puts PATH back.
let pathBefore: string | undefined;
beforeEach(() => {
  pathBefore = process.env.PATH;
});
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(process.env.PATH).toBe(pathBefore);
});

const SRC = join(import.meta.dir, "../src");

/** Every file under `dir` that is TypeScript. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("sync-git: the daemon does not wait for a process on the way to answer", () => {
  test("the only synchronous spawns left in the daemon are the ones listed, each with its reason", () => {
    const found = sources(SRC)
      .filter((file) => /\b(spawnSync|execFileSync|execSync)\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file).replaceAll("\\", "/"))
      .sort();
    expect(found).toEqual([
      // `exclude`: the fallback of a repository whose exclude file was not looked up yet.
      "board/worktree.ts",
      // `keyFor`: the answer on the spot for the few callers that cannot wait; the places on a
      // request or a timer ask `resolve` or are warmed first.
      "central/project-key.ts",
      // `repoRoot`: the fallback of a project whose root was not looked up yet.
      "memory/memory.ts",
      // The test runtime commits in a fixture repository, like a person would.
      "runtime/fake-runtime.ts",
    ]);
  });
});

describe("sync-git: a slow git does not stop the protocol", () => {
  async function served() {
    const claudeDir = tempDir("fd-claude-");
    const { board, manager, repo, root } = newBoard();
    const memory = new ProjectMemory({ claudeDir });
    const { id: projectId } = await board.addProject({ path: repo });
    const server = startServer({
      manager,
      board,
      memory,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return { client, projectId, root };
  }

  /**
   * The longest stretch the event loop (the server's and this client's are one) went without
   * turning while `during` was asked: a spawn the daemon waits for shows here whole.
   */
  async function longestBlockWhile(sleeping: SleepingGit, during: () => Promise<unknown>) {
    let longest = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 5);
    try {
      await during();
      // A tick after the work ends is where a block that came before it shows.
      await Bun.sleep(15);
    } finally {
      clearInterval(ticker);
      sleeping.restore();
    }
    return longest;
  }

  /** How long `host.info` takes to answer while `during` runs on the same daemon. */
  async function hostInfoWhile(
    client: FrameClient,
    sleeping: SleepingGit,
    during: () => Promise<unknown>,
  ) {
    let slowest = 0;
    const work = during();
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await client.request("host.info", {});
      slowest = Math.max(slowest, performance.now() - started);
      await Bun.sleep(20);
    }
    await work;
    expect(sleeping.calls().length).toBeGreaterThan(0);
    return slowest;
  }

  test("host.info answers under 100 ms while a project is added and while a card starts, with a git that sleeps", async () => {
    const { client, projectId, root } = await served();
    const other = join(root, "other");
    mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    const sleeping = installSleepingGit(300);
    const adding = await hostInfoWhile(client, sleeping, () =>
      client.request("project.add", { path: other }),
    );
    expect(adding).toBeLessThan(100);
    const card = (await client.request("card.create", {
      projectId,
      title: "t",
      description: "d",
    })) as {
      id: string;
    };
    const starting = await hostInfoWhile(client, sleeping, () =>
      client.request("card.start", { cardId: card.id }),
    );
    expect(starting).toBeLessThan(100);
  });

  test("memory.list asks git for the repository root and the daemon does not hold the event loop", async () => {
    const { client, projectId } = await served();
    const sleeping = installSleepingGit(300);
    const blocked = await longestBlockWhile(sleeping, () =>
      client.request("memory.list", { projectId }),
    );
    expect(sleeping.calls().some((args) => args.includes("--git-common-dir"))).toBe(true);
    expect(blocked).toBeLessThan(100);
  });

  test("looking up where a repository keeps its exclude file does not hold the event loop, and the synchronous call that follows asks git nothing", async () => {
    const { repo } = gitRepo();
    const sleeping = installSleepingGit(300);
    const blocked = await longestBlockWhile(sleeping, () => excludeLocalSettingsAsync(repo));
    expect(sleeping.calls().some((args) => args.includes("--git-path"))).toBe(true);
    expect(blocked).toBeLessThan(100);
    // The line is in the file, and a second look finds it there.
    const again = installSleepingGit(300);
    cleanups.push(() => again.restore());
    excludeLocalSettings(repo);
    expect(again.calls()).toEqual([]);
  });

  test("board.budgetBlocked reads the cached key of a project added through the board and asks git nothing", async () => {
    const keys = new ProjectKeys("h");
    const asked: string[] = [];
    const { board, repo } = newBoard({
      projectKeys: keys,
      budgets: {
        blocked: (key) => {
          asked.push(key);
          return false;
        },
        watch: () => () => {},
      },
    });
    const { id } = await board.addProject({ path: repo });
    const sleeping = installSleepingGit(300);
    cleanups.push(() => sleeping.restore());
    const blocked = (board as unknown as { budgetBlocked(id: string): boolean }).budgetBlocked(id);
    expect(blocked).toBe(false);
    expect(asked).toEqual([keys.keyFor(repo)]);
    expect(sleeping.calls()).toEqual([]);
  });

  test("the usage indexer looks up the project of a transcript's folder without holding the event loop, and then keyFor asks git nothing", async () => {
    const { repo } = gitRepo();
    const root = join(tempDir("fd-usage-"), "projects");
    mkdirSync(root);
    writeUsageTranscript(root, "p", repo, { subagent: false });
    const sleeping = installSleepingGit(300);
    const keys = new ProjectKeys("h");
    const indexer = new UsageIndexer({
      db: new EventStore(":memory:").db,
      roots: [root],
      projectKey: (cwd) => keys.keyFor(cwd),
      warmKeys: (cwds) => Promise.all(cwds.map((cwd) => keys.resolve(cwd))),
    });
    const blocked = await longestBlockWhile(sleeping, () => indexer.pass());
    expect(blocked).toBeLessThan(100);
    const calls = sleeping.calls().length;
    expect(calls).toBeGreaterThan(0);
    // Cached now: the synchronous answer does not start another process.
    keys.keyFor(repo);
    expect(sleeping.calls()).toHaveLength(calls);
  });

  test("adding a project, and the daemon's start for the ones it has, look their keys up so the budget check and the vault find them cached", async () => {
    const asked: string[][] = [];
    const keys = new ProjectKeys(
      "h",
      (args) => {
        asked.push(args);
        return { code: 1, stdout: "" };
      },
      async () => ({ code: 1, stdout: "" }),
    );
    const { board, manager, store, root, repo } = newBoard({ projectKeys: keys });
    const added = await board.addProject({ path: repo });
    expect(typeof keys.lookup(repo)).toBe("string");
    // A board that started later over the same projects has to warm them itself.
    const later = new ProjectKeys(
      "h",
      () => ({ code: 1, stdout: "" }),
      async () => ({ code: 1, stdout: "" }),
    );
    const restarted = new Board({
      db: store.db,
      manager,
      allowedRoots: [root],
      projectKeys: later,
    });
    expect(typeof later.lookup(added.path)).toBe("object");
    await restarted.warmProjectKeys();
    expect(typeof later.lookup(added.path)).toBe("string");
    expect(asked).toEqual([]);
  });
});
