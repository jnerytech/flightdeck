import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { localDay, UsageLedger } from "../src/quota/usage.ts";
import { startServer } from "../src/server.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "usage-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const DAY = 86_400_000;
/** The host is at UTC−3: 01:30 UTC is still the day before there. */
const minus3 = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);

/** A manager whose turns go to a ledger on its own store, with a clock moved by hand. */
function ledgerSetup() {
  let now = Date.UTC(2026, 9, 2, 1, 30);
  const box: { ledger: UsageLedger | null } = { ledger: null };
  const ctx = newManager({ onTurn: (id, cwd, turn) => box.ledger?.record(id, cwd, turn) });
  const ledger = new UsageLedger({
    db: ctx.store.db,
    projectKey: (cwd) => `p:${basename(cwd)}`,
    now: () => now,
    day: minus3,
  });
  box.ledger = ledger;
  const other = join(ctx.root, "outro");
  mkdirSync(other);
  /** Sends `text` and waits for the session to be idle again. */
  const turn = async (sessionId: string, text: string) => {
    const before = ctx.manager.get(sessionId).lastSeq;
    ctx.manager.send(sessionId, text);
    await poll(
      () =>
        ctx.manager.get(sessionId).lastSeq > before && ctx.manager.get(sessionId).status === "idle",
      3000,
    );
  };
  const open = async (cwd: string, prompt: string) => {
    const { sessionId } = ctx.manager.create({ cwd, prompt });
    await poll(() => ctx.manager.get(sessionId).status === "idle", 3000);
    return sessionId;
  };
  return { ...ctx, ledger, other, turn, open, move: (ms: number) => (now += ms) };
}

describe("uso", () => {
  test("usage_daily soma por dia (no fuso do host) e projeto, com o custo pela diferença do total", async () => {
    const { ledger, project, other, turn, open, move } = ledgerSetup();
    const a = await open(project, "[cost:0.25]");
    await turn(a, "[cost:0.5]");
    await open(other, "[cost:1]");
    move(DAY);
    await turn(a, "nada");
    await turn(a, "[cost:0.25]");
    expect(ledger.summary(7)).toEqual({
      days: 7,
      rows: [
        {
          day: "2026-10-02",
          projectKey: "p:project",
          costUsd: 0.25,
          inputTokens: 20,
          outputTokens: 40,
          turns: 2,
        },
        {
          day: "2026-10-01",
          projectKey: "p:outro",
          costUsd: 1,
          inputTokens: 10,
          outputTokens: 20,
          turns: 1,
        },
        // 0.25 then 0.75 as the session's total: 0.75, never 0.25 + 0.75.
        {
          day: "2026-10-01",
          projectKey: "p:project",
          costUsd: 0.75,
          inputTokens: 20,
          outputTokens: 40,
          turns: 2,
        },
      ],
    });
  });

  test("usage.summary só traz os últimos dias pedidos", async () => {
    const { ledger, project, open, move } = ledgerSetup();
    await open(project, "[cost:0.5]");
    move(3 * DAY);
    expect(ledger.summary(3).rows).toEqual([]);
    expect(ledger.summary(4).rows.map((r) => r.day)).toEqual(["2026-10-01"]);
    expect(ledger.summary().days).toBe(7);
  });

  test("turno sem custo nem tokens conta só o turno", () => {
    const { store } = newManager();
    const ledger = new UsageLedger({
      db: store.db,
      projectKey: () => "p",
      now: () => 0,
      day: () => "d",
    });
    ledger.record("s", "/x", {
      type: "turn.result",
      subtype: "success",
      isError: false,
      durationMs: 1,
    });
    expect(ledger.summary(1).rows).toEqual([
      { day: "d", projectKey: "p", costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 1 },
    ]);
  });

  test("o dia padrão é o do fuso do host, em AAAA-MM-DD", () => {
    const at = new Date(2026, 9, 1, 23, 59);
    expect(localDay(at.getTime())).toBe("2026-10-01");
    // Found by content: parallel tracks renumber their migrations on rebase.
    expect(MIGRATIONS.some((m) => m.includes("CREATE TABLE usage_daily"))).toBe(true);
  });

  test("usage.summary pelo protocolo, e o daemon liga as sessões ao uso", async () => {
    const dir = tempDir();
    const { root, project } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    await client.request("session.create", { cwd: project, prompt: "[cost:0.5]" });
    let rows: Array<{ costUsd: number; projectKey: string }> = [];
    // Bounded by time, not by tries: the turn waits on `git` processes, and a request that
    // takes long on a slow machine must not eat the tries.
    for (const until = Date.now() + 10_000; rows.length === 0 && Date.now() < until; ) {
      rows = (await client.data<{ rows: typeof rows }>("usage.summary", {}))?.rows ?? [];
      if (rows.length === 0) await Bun.sleep(20);
    }
    expect(rows).toEqual([expect.objectContaining({ costUsd: 0.5, turns: 1 })]);
    expect(rows[0]?.projectKey ?? "").toEndWith(project);
    const bad = await client.request("usage.summary", { days: 0 });
    expect(bad).toMatchObject({ ok: false, error: { code: "bad_request" } });
    // Through startServer too, with the ledger handed in.
    const { manager, store, root: other } = newManager();
    const ledger = new UsageLedger({ db: store.db, projectKey: () => "p", day: () => "d" });
    const server = startServer({
      manager,
      usage: ledger,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [other],
    });
    cleanups.push(() => server.stop());
    const second = new FrameClient(server.url);
    cleanups.push(() => second.close());
    await second.request("hello", { token: TOKEN, client: "t" });
    expect(await second.data("usage.summary", { days: 2 })).toEqual({ days: 2, rows: [] });
    // A whole daemon whose turn runs `git` several times (project key, snapshots): on the
    // Windows runner a stalled process start once took this test past the 5 s default. The other
    // tests that start a daemon already give themselves 20 s.
  }, 20_000);

  test("a turn whose project key is still being looked up reaches the ledger when the key arrives", async () => {
    const gate = Promise.withResolvers<string>();
    const { store, project } = newManager();
    const ledger = new UsageLedger({
      db: store.db,
      projectKey: () => gate.promise,
      day: () => "d",
    });
    const turn = { type: "turn.result", costUsd: 0.5, usage: { inputTokens: 3, outputTokens: 4 } };
    ledger.record("s1", project, turn as never);
    expect(ledger.summary(1).rows).toEqual([]);
    gate.resolve("p:late");
    await Bun.sleep(5);
    expect(ledger.summary(1).rows).toEqual([
      { day: "d", projectKey: "p:late", costUsd: 0.5, inputTokens: 3, outputTokens: 4, turns: 1 },
    ]);
  });

  test("a key that arrives after the store was closed is dropped quietly", async () => {
    const gate = Promise.withResolvers<string>();
    const { store, project } = newManager();
    const ledger = new UsageLedger({
      db: store.db,
      projectKey: () => gate.promise,
      day: () => "d",
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      ledger.record("s1", project, { type: "turn.result", costUsd: 1 } as never);
      expect(ledger.summary(1).rows).toEqual([]);
      store.db.close();
      gate.resolve("p:late");
      await Bun.sleep(20);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  test("with git held, the protocol keeps answering and the new session starts and is counted when git is released", async () => {
    const dir = tempDir();
    const { root, project } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [root],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const gate = Promise.withResolvers<void>();
    const asked: string[][] = [];
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
      {
        projectGit: async (args) => {
          asked.push(args);
          await gate.promise;
          return { code: 1, stdout: "" };
        },
      },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    // Not awaited: the new session's folder is looked up in git before it is created.
    const created = client.request("session.create", { cwd: project, prompt: "[cost:0.5]" });
    await poll(() => asked.length > 0, 2000);
    expect(asked.length).toBeGreaterThan(0);
    expect(await client.request("host.info", {})).toMatchObject({ ok: true });
    expect(await client.data("usage.summary", {})).toEqual({ days: 7, rows: [] });
    expect(await Promise.race([created, Promise.resolve("held")])).toBe("held");
    gate.resolve();
    expect(await created).toMatchObject({ ok: true });
    let rows: Array<{ costUsd: number; projectKey: string }> = [];
    for (const until = Date.now() + 5000; rows.length === 0 && Date.now() < until; ) {
      rows = (await client.data<{ rows: typeof rows }>("usage.summary", {}))?.rows ?? [];
      if (rows.length === 0) await Bun.sleep(10);
    }
    expect(rows).toEqual([expect.objectContaining({ costUsd: 0.5, turns: 1 })]);
    expect(rows[0]?.projectKey).toStartWith("host:");
    expect(rows[0]?.projectKey).toEndWith(project);
  }, 20_000);
});
