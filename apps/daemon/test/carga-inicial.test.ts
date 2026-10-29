import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Costs } from "../src/costs/costs.ts";
import { DEFAULT_PRICING } from "../src/costs/pricing.ts";
import { UsageIndexer, type UsageIndexerOptions } from "../src/costs/usage-indexer.ts";
import { startDaemon } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, poll, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession, usageEntries, writeUsageTranscript } from "./usage-helpers.ts";

const TOKEN = "initial-load-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface Status {
  initialLoad: { state: string; filesDone: number; filesTotal: number };
  unpriced: Array<{ model: string }>;
  divergences: unknown[];
}

/** Three transcripts (no subagents) and an indexer whose pauses the test can hold. */
function setup(overrides: Partial<UsageIndexerOptions> = {}) {
  const store = new EventStore(":memory:");
  const root = join(tempDir("fd-load-"), "projects");
  mkdirSync(root);
  const paths = ["a", "b", "c"].map(
    (p) =>
      writeUsageTranscript(root, p, "/work/app", { id: `s-${p}`, prefix: p, subagent: false }).main,
  );
  const gate = { pauses: 0, release: () => {}, hold: false };
  const indexer = new UsageIndexer({
    db: store.db,
    roots: [root],
    projectKey: (cwd) => `k:${basename(cwd)}`,
    pause: () => {
      gate.pauses++;
      if (!gate.hold) return Promise.resolve();
      gate.hold = false;
      return new Promise((resolve) => {
        gate.release = resolve;
      });
    },
    ...overrides,
  });
  cleanups.push(() => indexer.stop());
  const costs = new Costs({
    db: store.db,
    pricing: DEFAULT_PRICING,
    initialLoad: () => indexer.status(),
  });
  return { db: store.db, root, paths, gate, indexer, costs };
}

describe("carga-inicial", () => {
  test("a carga roda em segundo plano: costs.status mostra o progresso e o daemon responde durante ela", async () => {
    const { db, gate, indexer, costs } = setup();
    insertSession(db, "m-a", "s-a", "/work/app");
    db.query(
      "INSERT INTO events (session_id, seq, ts, type, payload) VALUES ('m-a', 1, 'x', 'turn.result', ?)",
    ).run(JSON.stringify({ type: "turn.result", costUsd: 1 }));
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      costs,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    gate.hold = true;
    indexer.start();
    await poll(() => gate.pauses === 1);
    const during = await client.data<Status>("costs.status", {});
    expect(during?.initialLoad).toEqual({ state: "running", filesDone: 1, filesTotal: 3 });
    // Partial entries would look like divergences: none until the load ends.
    expect(during?.divergences).toEqual([]);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toEqual([
      "costs",
    ]);
    gate.release();
    await indexer.idle();
    const after = await client.data<Status>("costs.status", {});
    expect(after?.initialLoad).toEqual({ state: "done", filesDone: 3, filesTotal: 3 });
    expect(after?.divergences).toHaveLength(1);
    expect(usageEntries(db)).toHaveLength(12);
  });

  test("pedidos durante uma passada viram uma só passada depois dela", async () => {
    const { db, paths, gate, indexer } = setup();
    gate.hold = true;
    indexer.start();
    await poll(() => gate.pauses === 1);
    const line = readFileSync(paths[0] as string, "utf8").split("\n")[5] as string;
    appendFileSync(paths[0] as string, `${line.replace('"id":"msg_aB"', '"id":"msg_aNovo"')}\n`);
    indexer.request();
    indexer.request();
    indexer.request();
    gate.release();
    await indexer.idle();
    expect(gate.pauses).toBe(6);
    expect(usageEntries(db).some((e) => e.message_id === "msg_aNovo")).toBe(true);
  });

  test("sem pausa injetada, a carga cede o laço de eventos entre arquivos", async () => {
    const { indexer } = setup({ pause: undefined });
    indexer.start();
    expect(indexer.status()).toEqual({ state: "running", filesDone: 1, filesTotal: 3 });
    await indexer.idle();
    expect(indexer.status()).toEqual({ state: "done", filesDone: 3, filesTotal: 3 });
  });

  test("arquivo apagado durante a carga não interrompe; falha numa passada vai para o log", async () => {
    const { db, paths, gate, indexer } = setup();
    gate.hold = true;
    indexer.start();
    await poll(() => gate.pauses === 1);
    const read = usageEntries(db)[0]?.claude_session_id;
    for (const path of paths) if (!path.includes(`${read}.jsonl`)) rmSync(path);
    gate.release();
    await indexer.idle();
    expect(indexer.status()).toEqual({ state: "done", filesDone: 3, filesTotal: 3 });
    expect(usageEntries(db)).toHaveLength(4);

    const logs: string[] = [];
    let calls = 0;
    const failing = setup({
      log: (m) => logs.push(m),
      projectKey: () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return "k";
      },
    });
    failing.indexer.start();
    await failing.indexer.idle();
    expect(logs).toEqual(["custos: falha na leitura de uso (boom)"]);
    failing.indexer.request();
    await failing.indexer.idle();
    expect(usageEntries(failing.db)).toHaveLength(12);
  });

  test("o daemon lê o uso dos transcripts no boot, segue as linhas novas e relê os preços da config no reprice", async () => {
    const dir = tempDir();
    const { root } = workspace();
    const projects = join(dir, "projects");
    const { main } = writeUsageTranscript(projects, "proj", "/work/app");
    const file = join(dir, "config.json");
    const config = {
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      history: { roots: [projects], scanIntervalMs: 50 },
    };
    writeFileSync(file, JSON.stringify(config));
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const client = new FrameClient(daemon.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const status = () => client.data<Status>("costs.status", {});
    const models = async () => (await status())?.unpriced.map((u) => u.model) ?? [];
    let loaded: Status | null = null;
    for (let i = 0; i < 100 && loaded?.initialLoad.state !== "done"; i++) {
      loaded = await status();
      if (loaded?.initialLoad.state !== "done") await Bun.sleep(20);
    }
    expect(loaded?.initialLoad).toEqual({ state: "done", filesDone: 2, filesTotal: 2 });
    expect(await models()).toEqual(["claude-mystery-9"]);
    const line = readFileSync(main, "utf8").split("\n")[5] as string;
    appendFileSync(
      main,
      `${line.replace('"id":"msg_B"', '"id":"msg_N"').replace("claude-opus-5-5", "claude-novo-1")}\n`,
    );
    let seen: string[] = [];
    for (let i = 0; i < 150 && seen.length < 2; i++) {
      seen = await models();
      if (seen.length < 2) await Bun.sleep(20);
    }
    expect(seen).toEqual(["claude-mystery-9", "claude-novo-1"]);
    const price = { input: 1, output: 1, cacheRead: 0 };
    writeFileSync(
      file,
      JSON.stringify({
        ...config,
        pricing: { models: { "claude-mystery-9": price, "claude-novo-1": price } },
      }),
    );
    expect(await client.data("costs.reprice", {})).toEqual({ entries: 6 });
    expect(await models()).toEqual([]);
    expect((await client.data<{ features: string[] }>("host.info", {}))?.features).toContain(
      "costs",
    );
  });
});
