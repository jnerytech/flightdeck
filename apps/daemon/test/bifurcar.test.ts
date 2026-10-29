import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Forker } from "../src/checkpoints/fork.ts";
import { Rewinder } from "../src/checkpoints/rewind.ts";
import { Snapshots } from "../src/checkpoints/snapshots.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

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
  const rewinder = new Rewinder({ snapshots, sessions: manager });
  const forker = new Forker({ runtime, manager, rewinder });
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

  test("runtime sem forkSession recusa", async () => {
    const { manager, repo } = setup();
    const forker = new Forker({ runtime: { start: () => ({}) as never }, manager });
    let message = "";
    try {
      await forker.fork({ claudeSessionId: "x", cwd: repo, open: "terminal" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("este runtime não bifurca sessões");
  });

  test("protocolo: session.fork", async () => {
    const { forker, manager, repo } = setup();
    const server = startServer({
      manager,
      forker,
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
