import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Forker } from "../../src/checkpoints/fork.ts";
import { Rewinder } from "../../src/checkpoints/rewind.ts";
import { Snapshots } from "../../src/checkpoints/snapshots.ts";
import { withoutPersonas } from "../../src/personas/domain/prepare.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { startServer } from "../../src/server.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { newManager, poll, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "fork-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup() {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const runtime = new FakeRuntime({ delayMs: 1 });
  const { repo } = gitRepo();
  const { manager } = newManager({ store, runtime, allowedRoots: [dirname(repo)] });
  const snapshots = new Snapshots({ db: store.db });
  const rewinder = new Rewinder({ snapshots, sessions: manager, allowedRoots: [dirname(repo)] });
  const forker = new Forker({ runtime, manager, rewinder, allowedRoots: [dirname(repo)] });
  return { store, runtime, manager, repo, snapshots, forker };
}

describe("bifurcar", () => {
  test("forkSession até a mensagem; abre como sessão gerenciada retomada no id novo", async () => {
    const { forker, runtime, manager, repo } = setup();
    const result = await forker.fork({
      claudeSessionId: "orig-1",
      upToMessageId: "uuid-turno-2",
      cwd: repo,
      open: "flightdeck",
    });
    expect(runtime.forks).toEqual([
      { claudeSessionId: "orig-1", upToMessageId: "uuid-turno-2", dir: repo },
    ]);
    expect(result.claudeSessionId).toStartWith("fake-fork-");
    const session = manager.get(result.sessionId as string);
    expect(session.claudeSessionId).toBe(result.claudeSessionId);
    expect(session.cwd).toBe(repo);
    expect(result.command).toBeUndefined();
  });

  test("sessão do terminal: devolve o comando para abrir no terminal, sem sessão gerenciada", async () => {
    const { forker, manager, repo } = setup();
    const result = await forker.fork({ claudeSessionId: "term-1", cwd: repo, open: "terminal" });
    expect(result.command).toBe(`flightdeckd claude --resume ${result.claudeSessionId}`);
    expect(result.sessionId).toBeUndefined();
    expect(manager.list()).toEqual([]);
  });

  test("com voltar arquivos, a volta acontece antes de abrir a bifurcação", async () => {
    const { forker, snapshots, repo } = setup();
    const before = await snapshots.take({ cwd: repo, claudeSessionId: "orig-1", kind: "before" });
    writeFileSync(join(repo, "depois.txt"), "criado no turno\n");
    const turn = "row" in before ? before.row.n : -1;
    await forker.fork({ claudeSessionId: "orig-1", cwd: repo, open: "terminal", rewindTurn: turn });
    expect(existsSync(join(repo, "depois.txt"))).toBe(false);
  });

  test("a rewind that would put back Claude Code's settings runs the guard before the fork and before any write (#3825)", async () => {
    const { forker, snapshots, runtime, repo } = setup();
    mkdirSync(join(repo, ".claude"));
    writeFileSync(join(repo, ".claude", "settings.json"), "{}\n");
    const before = await snapshots.take({ cwd: repo, claudeSessionId: "orig-1", kind: "before" });
    writeFileSync(join(repo, ".claude", "settings.json"), '{"hooks":{}}\n');
    const turn = "row" in before ? before.row.n : -1;
    const refused = await forker
      .fork({ claudeSessionId: "orig-1", cwd: repo, open: "terminal", rewindTurn: turn }, () => {
        throw new Error("guard ran");
      })
      .then(
        () => "forked",
        (error: Error) => error.message,
      );
    expect([
      refused,
      runtime.forks.length,
      readFileSync(join(repo, ".claude", "settings.json"), "utf8"),
    ]).toEqual(["guard ran", 0, '{"hooks":{}}\n']);
  });

  test("a rewind into a repository outside the roots is refused before any fork is made (#3554)", async () => {
    const { store, runtime, manager, snapshots, repo } = setup();
    const before = await snapshots.take({ cwd: repo, claudeSessionId: "orig-1", kind: "before" });
    writeFileSync(join(repo, "depois.txt"), "criado no turno\n");
    const turn = "row" in before ? before.row.n : -1;
    const strict = new Forker({
      runtime,
      manager,
      rewinder: new Rewinder({
        snapshots,
        sessions: manager,
        allowedRoots: [tempDir("fd-fork-other-root-")],
      }),
      allowedRoots: [dirname(repo)],
    });
    const refused = await strict
      .fork({ claudeSessionId: "orig-1", cwd: repo, open: "terminal", rewindTurn: turn })
      .then(
        () => "forked",
        (error: { reason?: string }) => error.reason,
      );
    expect([refused, runtime.forks.length, existsSync(join(repo, "depois.txt"))]).toEqual([
      "cwd_outside_roots",
      0,
      true,
    ]);
    store.close();
  });

  test("runtime sem forkSession recusa", async () => {
    const { manager, repo } = setup();
    const forker = new Forker({
      runtime: { start: () => ({}) as never },
      manager,
      allowedRoots: [dirname(repo)],
    });
    let message = "";
    try {
      await forker.fork({ claudeSessionId: "x", cwd: repo, open: "terminal" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("this runtime does not fork sessions");
  });

  test("protocolo: session.fork", async () => {
    const { forker, manager, repo } = setup();
    const server = startServer({
      manager,
      checkpoints: { forker },
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
    const result = await client.data<{ sessionId: string }>("session.fork", {
      claudeSessionId: "orig-1",
      cwd: repo,
      open: "flightdeck",
    });
    expect(result?.sessionId).toBeString();
    await poll(() => manager.list().length === 1, 3000);
    expect(manager.list()[0]?.id).toBe(result?.sessionId);
  });
});

/** What a refused fork leaves behind: the code and reason it was refused with, and everything it did before. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "was not refused";
  } catch (error) {
    const { code, reason } = error as { code?: string; reason?: string };
    return `${code} ${reason}`;
  }
}

describe("fork checks the folder as create does (#3550)", () => {
  /** A root with one folder in it, a folder outside it, and a Forker whose every step is recorded. */
  function guarded(options: { lockInside?: boolean } = {}) {
    const root = tempDir("fd-fork-root-");
    const inside = join(root, "inside");
    mkdirSync(inside);
    const outside = tempDir("fd-fork-outside-");
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager } = newManager({ store, runtime, allowedRoots: [root] });
    cleanups.push(() => manager.shutdown());
    const steps: string[] = [];
    const rewinder = {
      apply: async () => {
        steps.push("rewind");
      },
    } as unknown as Rewinder;
    const forker = new Forker({
      runtime,
      manager,
      rewinder,
      allowedRoots: [root],
      folderLocks: { isHeld: (cwd) => options.lockInside === true && cwd === inside },
      preparePersonas: (persona, cwd) => {
        steps.push(`personas ${cwd}`);
        return withoutPersonas(persona, cwd);
      },
    });
    return { root, inside, outside, runtime, manager, forker, steps };
  }
  const nothingDone = (g: ReturnType<typeof guarded>) => [g.runtime.forks, g.steps];

  for (const open of ["terminal", "flightdeck"] as const) {
    test(`a folder outside the roots is refused before anything is forked, rewound or read (open ${open})`, async () => {
      const g = guarded();
      const refused = await refusal(() =>
        g.forker.fork({
          claudeSessionId: "orig-1",
          cwd: g.outside,
          open,
          rewindTurn: 1,
        }),
      );
      expect([refused, ...nothingDone(g), g.manager.list()]).toEqual([
        "forbidden_cwd cwd_outside_roots",
        [],
        [],
        [],
      ]);
    });
  }

  test("a link inside the roots that leads outside is refused, for either open", async () => {
    const g = guarded();
    const link = join(g.root, "link");
    symlinkSync(g.outside, link);
    const refused = await Promise.all(
      (["terminal", "flightdeck"] as const).map((open) =>
        refusal(() => g.forker.fork({ claudeSessionId: "orig-1", cwd: link, open })),
      ),
    );
    expect([refused, ...nothingDone(g)]).toEqual([
      ["forbidden_cwd cwd_outside_roots", "forbidden_cwd cwd_outside_roots"],
      [],
      [],
    ]);
  });

  test("a folder inside the roots that does not exist is refused as missing, before the fork", async () => {
    const g = guarded();
    const refused = await refusal(() =>
      g.forker.fork({ claudeSessionId: "orig-1", cwd: join(g.root, "nope"), open: "terminal" }),
    );
    expect([refused, ...nothingDone(g)]).toEqual(["forbidden_cwd cwd_missing", [], []]);
  });

  test("a folder being removed is refused before the fork, for either open", async () => {
    const g = guarded({ lockInside: true });
    const refused = await Promise.all(
      (["terminal", "flightdeck"] as const).map((open) =>
        refusal(() => g.forker.fork({ claudeSessionId: "orig-1", cwd: g.inside, open })),
      ),
    );
    expect([refused, ...nothingDone(g), g.manager.list()]).toEqual([
      ["invalid_state folder_removing", "invalid_state folder_removing"],
      [],
      [],
      [],
    ]);
  });

  test("a folder inside the roots forks with the real path as the SDK's dir, for the terminal", async () => {
    const g = guarded();
    const link = join(g.root, "alias");
    symlinkSync(g.inside, link);
    const result = await g.forker.fork({ claudeSessionId: "orig-1", cwd: link, open: "terminal" });
    expect([g.runtime.forks.map((f) => f.dir), result.command === undefined]).toEqual([
      [g.inside],
      false,
    ]);
  });

  test("a folder inside the roots is rewound, forked and read once the check passed", async () => {
    const g = guarded();
    await g.forker.fork({
      claudeSessionId: "orig-1",
      cwd: g.inside,
      open: "flightdeck",
      rewindTurn: 1,
    });
    expect([g.steps, g.runtime.forks.map((f) => f.dir)]).toEqual([
      ["rewind", `personas ${g.inside}`],
      [g.inside],
    ]);
  });
});
