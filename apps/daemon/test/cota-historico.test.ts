import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startDaemon } from "../src/main.ts";
import { prune } from "../src/maintenance/retention.ts";
import { QuotaHistory } from "../src/quota/history.ts";
import type { QuotaReading } from "../src/runtime/types.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "quota-history-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1, 12);
/** The current 5-hour window resets at 17:00. */
const RESET = T0 + 5 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function setup() {
  const store = new EventStore(":memory:");
  let now = T0;
  const history = new QuotaHistory({ db: store.db, now: () => now });
  const read = (utilization: number, resetsAt = RESET, window = "five_hour"): QuotaReading => ({
    window,
    utilization,
    status: "allowed",
    resetsAt,
  });
  /** Moves the clock to `at` and takes these readings there. */
  const at = (ms: number, ...readings: QuotaReading[]) => {
    now = ms;
    history.sample(readings);
  };
  return { db: store.db, history, read, at };
}

describe("cota-historico", () => {
  test("cada leitura vira amostra; iguais da mesma janela em menos de 5 minutos viram uma só", () => {
    const { history, read, at } = setup();
    at(T0, read(0.2), read(0.1, T0 + 3 * DAY, "seven_day"));
    at(T0 + MIN, read(0.2));
    at(T0 + 2 * MIN, read(0.25));
    at(T0 + 3 * MIN, read(0.25));
    at(T0 + 9 * MIN, read(0.25));
    const sample = (ms: number, utilization: number) => ({
      utilization,
      status: "allowed",
      resetsAt: iso(RESET),
      takenAt: iso(ms),
    });
    expect(history.history("five_hour", 24).samples).toEqual([
      sample(T0, 0.2),
      sample(T0 + 2 * MIN, 0.25),
      sample(T0 + 9 * MIN, 0.25),
    ]);
    expect(history.history("seven_day", 24).samples).toHaveLength(1);
    // Only the last `hours`.
    expect(history.history("five_hour", 24).hours).toBe(24);
    at(T0 + 2 * DAY, read(0.3));
    expect(history.history("five_hour", 1).samples).toHaveLength(1);
  });

  test("projeção com 3 ou mais amostras da janela atual: hora em que esgota, ou não esgota antes do reinício", () => {
    const rising = setup();
    // The previous window (reset at 12:00) does not count.
    rising.at(T0 - HOUR, rising.read(0.9, T0));
    rising.at(T0, rising.read(0.2));
    rising.at(T0 + 30 * MIN, rising.read(0.3));
    expect(rising.history.history("five_hour", 24).projection).toBeNull();
    rising.at(T0 + 60 * MIN, rising.read(0.4));
    expect(rising.history.history("five_hour", 24).projection).toEqual({
      exhaustsAt: "2026-10-01T16:00:00.000Z",
      resetsAt: "2026-10-01T17:00:00.000Z",
      samples: 3,
    });
    const slow = setup();
    slow.at(T0, slow.read(0.1));
    slow.at(T0 + 30 * MIN, slow.read(0.12));
    slow.at(T0 + 60 * MIN, slow.read(0.14));
    expect(slow.history.history("five_hour", 24).projection).toEqual({
      exhaustsAt: null,
      resetsAt: "2026-10-01T17:00:00.000Z",
      samples: 3,
    });
    const flat = setup();
    for (const minutes of [0, 30, 60, 90]) flat.at(T0 + minutes * MIN, flat.read(0.3));
    expect(flat.history.history("five_hour", 24).projection?.exhaustsAt).toBeNull();
  });

  test("quem consumiu a janela de 5 horas: a fatia de cada projeto no custo desde o início dela", () => {
    const { db, history, read, at } = setup();
    let n = 0;
    const spend = (key: string, ms: number, cost: number | null) => {
      db.query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES (?, 's', ?, '2026-10-01', ?, 'm', 'terminal', 'standard', 0, 0, 0, 0, 0, ?)`,
      ).run(`m${++n}`, iso(ms), key, cost);
    };
    spend("kA", T0 + 10 * MIN, 3);
    spend("kB", T0 + 20 * MIN, 1);
    spend("kB", T0 + 25 * MIN, null);
    spend("kC", T0 - 10 * MIN, 10);
    at(T0 + 30 * MIN, read(0.4), read(0.1, T0 + 3 * DAY, "seven_day"));
    expect(history.history("five_hour", 24).consumers).toEqual([
      { projectKey: "kA", costUsd: 3, share: 0.75 },
      { projectKey: "kB", costUsd: 1, share: 0.25 },
    ]);
    expect(history.history("seven_day", 24).consumers).toEqual([]);
  });

  test("retenção: amostras da cota por 30 dias e uso por usageDays (padrão 400), contados na limpeza", () => {
    const { db } = setup();
    const now = T0;
    db.query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
         speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('velha', 's', ?, 'd', 'k', 'm', 'app', 'standard', 0, 0, 0, 0, 0, 1),
              ('nova', 's', ?, 'd', 'k', 'm', 'app', 'standard', 0, 0, 0, 0, 0, 1)`,
    ).run(iso(now - 401 * DAY), iso(now - 10 * DAY));
    db.query(
      `INSERT INTO quota_samples (window, utilization, resets_at, status, taken_at)
       VALUES ('five_hour', 0.1, NULL, 'allowed', ?), ('five_hour', 0.2, NULL, 'allowed', ?)`,
    ).run(iso(now - 31 * DAY), iso(now - DAY));
    const policy = { eventsDays: 90, externalSessionsDays: 30, usageDays: 400 };
    const counts = {
      events: 0,
      permission_requests: 0,
      external_sessions: 0,
      usage_entries: 1,
      quota_samples: 1,
    };
    expect(prune(db, policy, { now, dryRun: true })).toEqual(counts);
    expect(prune(db, policy, { now })).toEqual(counts);
    const left = (table: string) =>
      (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([left("usage_entries"), left("quota_samples")]).toEqual([1, 1]);
  });

  test("quota.history pelo protocolo, e o daemon guarda as leituras das sessões", async () => {
    const { history, read, at } = setup();
    at(T0, read(0.2));
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      quotaHistory: history,
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
    const got = await client.data<{ samples: unknown[] }>("quota.history", {
      window: "five_hour",
      hours: 24,
    });
    expect(got?.samples.length ?? 0).toBe(1);
    expect(await client.request("quota.history", { window: "five_hour", hours: 0 })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });

    const dir = tempDir();
    const { root: allowed, project } = workspace();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        allowedRoots: [allowed],
        history: { roots: [join(dir, "nada")] },
      }),
    );
    const daemon = await startDaemon(
      { command: "start", config: file, runtime: "fake" },
      {},
      { log: () => {}, error: () => {} },
    );
    cleanups.push(() => daemon.stop());
    const live = new FrameClient(daemon.url);
    cleanups.push(() => live.close());
    await live.request("hello", { token: TOKEN, client: "t" });
    const epoch = Math.floor(Date.now() / 1000) + 3600;
    await live.request("session.create", {
      cwd: project,
      prompt: `[ratelimit:five_hour=0.4@${epoch}]`,
    });
    const samples = async () =>
      (await live.data<{ samples: unknown[] }>("quota.history", { window: "five_hour", hours: 24 }))
        ?.samples.length ?? 0;
    let count = 0;
    for (let i = 0; i < 100 && count === 0; i++) {
      count = await samples();
      if (count === 0) await Bun.sleep(20);
    }
    expect(count).toBe(1);
  });

  test("daemon sem os recursos da fase recusa quota.history, costs.* e budget.* com invalid_state", async () => {
    const { manager, root } = newManager();
    const server = startServer({
      manager,
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
    const codes = await Promise.all(
      [
        ["quota.history", { window: "five_hour", hours: 1 }],
        ["costs.status", {}],
        ["budget.list", {}],
      ].map(async ([type, payload]) => {
        const ack = await client.request(type as string, payload);
        return (ack.error as { code?: string } | undefined)?.code ?? "ok";
      }),
    );
    expect(codes).toEqual(["invalid_state", "invalid_state", "invalid_state"]);
  });
});
