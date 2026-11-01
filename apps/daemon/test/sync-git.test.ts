import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { installSleepingGit, type SleepingGit } from "../../../scripts/test/sleeping-git.ts";
import { ProjectMemory } from "../src/memory/memory.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "sync-git-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
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
    const { board, manager, repo } = newBoard();
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
    return { client, projectId };
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
    } finally {
      clearInterval(ticker);
      sleeping.restore();
    }
    return longest;
  }

  test("memory.list asks git for the repository root and the daemon does not hold the event loop", async () => {
    const { client, projectId } = await served();
    const sleeping = installSleepingGit(300);
    const blocked = await longestBlockWhile(sleeping, () =>
      client.request("memory.list", { projectId }),
    );
    expect(sleeping.calls().some((args) => args.includes("--git-common-dir"))).toBe(true);
    expect(blocked).toBeLessThan(100);
  });
});
