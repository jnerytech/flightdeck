import { describe, expect, test } from "bun:test";
import { killTree as killTreeOfCommand, runCommand } from "../src/board/command.ts";
import { killTree, terminalRunHost } from "../src/runenv/host.ts";
import { RunManager } from "../src/runenv/manager.ts";
import { CardPorts } from "../src/runenv/ports.ts";
import { EventStore } from "../src/store/event-store.ts";
import { fakeRunHost, runConfig } from "./run-helpers.ts";

/** A `taskkill` that ends `ms` later, like one that has a tree to walk. */
const late =
  (ms: number, done: string[] = []) =>
  async () => {
    await Bun.sleep(ms);
    done.push("taskkill");
  };

/** How long `work` took, and what it gave. */
async function timed<T>(work: Promise<T>) {
  const started = performance.now();
  const value = await work;
  return { value, ms: performance.now() - started };
}

describe("run-arvore: whoever kills a tree and then uses its files or ports waits for it to be gone", () => {
  test("killTree of the run host settles when taskkill has ended, and does not throw when it fails", async () => {
    const done: string[] = [];
    const { ms } = await timed(killTree(4321, { platform: "win32", run: late(80, done) }));
    expect(done).toEqual(["taskkill"]);
    expect(ms).toBeGreaterThanOrEqual(70);
    await expect(
      killTree(4321, {
        platform: "win32",
        run: async () => {
          throw new Error("sem taskkill");
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("killTree of a command settles when taskkill has ended, and a group kill on Linux settles at once", async () => {
    const done: string[] = [];
    const { ms } = await timed(killTreeOfCommand(4321, "win32", () => {}, late(80, done)));
    expect(done).toEqual(["taskkill"]);
    expect(ms).toBeGreaterThanOrEqual(70);
    const signals: Array<[number, string]> = [];
    await killTreeOfCommand(4321, "linux", (pid, signal) => void signals.push([pid, signal]));
    expect(signals).toEqual([[-4321, "SIGKILL"]]);
  });

  test("a command that ran out of time is not given back before its tree is gone", async () => {
    const gone: string[] = [];
    const result = await timed(
      runCommand(
        [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        process.cwd(),
        undefined,
        50,
        async (pid) => {
          process.kill(-pid, "SIGKILL");
          await Bun.sleep(120);
          gone.push("tree");
        },
      ),
    );
    expect(result.value.timedOut).toBe(true);
    expect(gone).toEqual(["tree"]);
    expect(result.ms).toBeGreaterThanOrEqual(150);
  });

  test("the run host closes the terminal at once but settles only when the tree is gone", async () => {
    const closed: string[] = [];
    const host = terminalRunHost(
      {
        open: () => ({ terminalId: "t" }),
        close: (id: string) => void closed.push(id),
        pidOf: () => 4321,
      } as never,
      { treeKill: late(80) },
    );
    const killing = host.kill("t");
    expect(closed).toEqual(["t"]);
    const { ms } = await timed(Promise.resolve(killing));
    expect(ms).toBeGreaterThanOrEqual(60);
  });

  test("stopping a card waits for the tree of each process, and only then says it ended", async () => {
    const fake = fakeRunHost();
    const killedAt: number[] = [];
    const host = {
      ...fake.host,
      kill: async (terminalId: string) => {
        fake.host.kill(terminalId);
        await Bun.sleep(80);
        killedAt.push(performance.now());
      },
    };
    const store = new EventStore(":memory:");
    const manager = new RunManager({
      db: store.db,
      configs: { resolve: async () => runConfig({ setup: null }) },
      ports: new CardPorts({ db: store.db, isFree: async () => true }),
      host,
      card: (cardId) => ({ id: cardId, projectId: "proj", worktreePath: `/work/${cardId}` }),
      project: (id) => ({ id, path: "/repo", baseBranch: "main" }),
    });
    await manager.start("card-a");
    const deadline = Date.now() + 1000;
    while (fake.spawned.length < 2 && Date.now() < deadline) await Bun.sleep(5);
    const { value, ms } = await timed(manager.stop("card-a"));
    expect(value.status).toBe("ended");
    expect(killedAt).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(70);
  });

  test("idle settles only when every card being stopped has its trees gone", async () => {
    const fake = fakeRunHost();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = {
      ...fake.host,
      kill: async (terminalId: string) => {
        fake.host.kill(terminalId);
        await gate;
      },
    };
    const store = new EventStore(":memory:");
    const manager = new RunManager({
      db: store.db,
      configs: { resolve: async () => runConfig({ setup: null }) },
      ports: new CardPorts({ db: store.db, isFree: async () => true }),
      host,
      card: (cardId) => ({ id: cardId, projectId: "proj", worktreePath: `/work/${cardId}` }),
      project: (id) => ({ id, path: "/repo", baseBranch: "main" }),
    });
    await manager.idle();
    await manager.start("card-a");
    const deadline = Date.now() + 1000;
    while (fake.spawned.length < 2 && Date.now() < deadline) await Bun.sleep(5);
    const stopping = manager.stop("card-a");
    let idle = false;
    const idling = manager.idle().then(() => {
      idle = true;
    });
    await Bun.sleep(60);
    expect(idle).toBe(false);
    release();
    await stopping;
    await idling;
    expect(idle).toBe(true);
  });
});
