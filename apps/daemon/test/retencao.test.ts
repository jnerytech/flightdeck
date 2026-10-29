import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config, loadConfig } from "../src/config.ts";
import { parseArgs, runCli } from "../src/main.ts";
import { Maintenance } from "../src/maintenance/maintenance.ts";
import { prune } from "../src/maintenance/retention.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const POLICY = { eventsDays: 90, externalSessionsDays: 30, usageDays: 400 };

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A database with sessions in every situation the policy distinguishes. */
function fixture(path = ":memory:") {
  const store = new EventStore(path);
  const db = store.db;
  const session = (id: string, status: string, updated: string) => {
    db.query(
      `INSERT INTO sessions (id, claude_session_id, cwd, status, permission_mode, last_seq, created_at, updated_at)
       VALUES (?, ?, '/p', ?, 'default', 2, ?, ?)`,
    ).run(id, `c-${id}`, status, updated, updated);
    for (const seq of [1, 2]) {
      db.query(
        "INSERT INTO events (session_id, seq, ts, type, payload) VALUES (?, ?, ?, 'message.user', '{}')",
      ).run(id, seq, updated);
    }
    db.query(
      `INSERT INTO permission_requests (id, session_id, tool_name, input, status, created_at)
       VALUES (?, ?, 'Write', '{}', 'allowed', ?)`,
    ).run(`p-${id}`, id, updated);
  };
  session("old", "ended", ago(100)); // pruned
  session("old-error", "error", ago(91)); // pruned
  session("recent", "ended", ago(10)); // kept: within 90 days
  session("live", "idle", ago(200)); // kept: alive
  session("pinned", "ended", ago(300)); // kept: pinned
  session("card-open", "ended", ago(300)); // kept: card outside Concluído
  session("card-done", "ended", ago(300)); // pruned: card done
  session("step-open", "ended", ago(300)); // kept: workflow step of an open card
  db.query("INSERT INTO session_meta (claude_session_id, pinned) VALUES ('c-pinned', 1)").run();
  db.query(
    `INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template)
     VALUES ('p1', '/p', 'p', 'main', 'none', '')`,
  ).run();
  for (const [card, column] of [
    ["k-open", "review"],
    ["k-done", "done"],
    ["k-wf", "in_progress"],
  ]) {
    db.query(
      `INSERT INTO cards (id, project_id, title, description, board_column, position, created_at, updated_at)
       VALUES (?, 'p1', 't', 'd', ?, 1, ?, ?)`,
    ).run(card as string, column as string, ago(1), ago(1));
  }
  db.query(
    "INSERT INTO card_runs (id, card_id, session_id, queued_at) VALUES ('r1', 'k-open', 'card-open', ?)",
  ).run(ago(300));
  db.query(
    "INSERT INTO card_runs (id, card_id, session_id, queued_at) VALUES ('r2', 'k-done', 'card-done', ?)",
  ).run(ago(300));
  db.exec(
    `INSERT INTO workflow_runs (id, card_id, workflow_name, workflow_hash, definition, status, budget, usage, inputs, started_at)
     VALUES ('w1', 'k-wf', 'wf', 'h', '{}', 'running', '{}', '{}', '{}', '${ago(300)}')`,
  );
  db.exec(
    `INSERT INTO step_runs (run_id, step_id, attempt, type, status, session_id, started_at)
     VALUES ('w1', 's1', 1, 'agent', 'done', 'step-open', '${ago(300)}')`,
  );
  // External sessions: one ended 40 days ago, one ended 5 days ago, one alive, one pinned.
  const external = (id: string, status: string, ended: string | null) =>
    db
      .query(
        `INSERT INTO external_sessions (claude_session_id, status, started_at, last_event_at, ended_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, status, ago(400), ended ?? ago(0), ended);
  external("e-old", "ended", ago(40));
  external("e-recent", "ended", ago(5));
  external("e-live", "running", null);
  external("e-pinned", "ended", ago(40));
  db.query("INSERT INTO session_meta (claude_session_id, pinned) VALUES ('e-pinned', 1)").run();
  const eventsOf = (id: string) =>
    (db.query("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get(id) as { n: number }).n;
  const externals = () =>
    (
      db.query("SELECT claude_session_id AS id FROM external_sessions ORDER BY id").all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
  return { store, db, eventsOf, externals };
}

describe("retencao", () => {
  test("apaga só o que passou do prazo e nunca sessão viva, fixada ou de card aberto", () => {
    const { db, eventsOf, externals } = fixture();
    const counts = prune(db, POLICY, { now: NOW });
    expect(counts).toEqual({
      events: 6,
      permission_requests: 3,
      external_sessions: 1,
      usage_entries: 0,
      quota_samples: 0,
    });
    for (const gone of ["old", "old-error", "card-done"]) expect(eventsOf(gone)).toBe(0);
    for (const kept of ["recent", "live", "pinned", "card-open", "step-open"]) {
      expect(eventsOf(kept)).toBe(2);
    }
    expect(externals()).toEqual(["e-live", "e-pinned", "e-recent"]);
    // The sessions themselves, cards and meta stay.
    expect((db.query("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(8);
    expect(prune(db, POLICY, { now: NOW })).toEqual({
      events: 0,
      permission_requests: 0,
      external_sessions: 0,
      usage_entries: 0,
      quota_samples: 0,
    });
  });

  test("0 apaga assim que encerra", () => {
    const { db, eventsOf, externals } = fixture();
    prune(db, { eventsDays: 0, externalSessionsDays: 0, usageDays: 400 }, { now: NOW });
    expect(eventsOf("recent")).toBe(0);
    expect(eventsOf("live")).toBe(2);
    expect(externals()).toEqual(["e-live", "e-pinned"]);
  });

  test("dryRun só conta", () => {
    const { db, eventsOf } = fixture();
    expect(prune(db, POLICY, { now: NOW, dryRun: true })).toEqual({
      events: 6,
      permission_requests: 3,
      external_sessions: 1,
      usage_entries: 0,
      quota_samples: 0,
    });
    expect(eventsOf("old")).toBe(2);
  });

  test("roda no boot e a cada 24 h com relógio e agendador injetados, e guarda a última limpeza", () => {
    const { db, eventsOf } = fixture();
    const dataDir = tempDir();
    let now = NOW;
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    const maintenance = new Maintenance({
      db,
      dataDir,
      retention: POLICY,
      now: () => now,
      timers: {
        setInterval: (fn: () => void, ms: number) => {
          intervals.push({ fn, ms });
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
        clearInterval: () => {},
      },
    });
    maintenance.start();
    cleanups.push(() => maintenance.stop());
    expect(eventsOf("old")).toBe(0);
    expect(intervals.map((i) => i.ms)).toEqual([DAY]);
    expect(maintenance.lastPrune()).toMatchObject({
      at: new Date(NOW).toISOString(),
      dryRun: false,
    });
    // A day later "recent" is still recent; 81 days later it goes.
    now += 81 * DAY;
    intervals[0]?.fn();
    expect(eventsOf("recent")).toBe(0);
    expect(maintenance.lastPrune()?.counts.events).toBe(2);
    expect(existsSync(join(dataDir, "maintenance.json"))).toBe(true);
    expect(maintenance.prune(true)).toEqual({
      events: 0,
      permission_requests: 0,
      external_sessions: 0,
      usage_entries: 0,
      quota_samples: 0,
    });
    expect(maintenance.lastPrune()?.dryRun).toBe(true);
  });

  test("retention na config: padrões 90, 30 e 400 dias", () => {
    expect(Config.parse({}).retention).toEqual({
      eventsDays: 90,
      externalSessionsDays: 30,
      usageDays: 400,
    });
    expect(Config.parse({ retention: { eventsDays: 1 } }).retention.usageDays).toBe(400);
    expect(Config.safeParse({ retention: { eventsDays: -1 } }).success).toBe(false);
  });

  test("ação de db desconhecida é recusada", () => {
    let message = "aceitou";
    try {
      parseArgs(["db", "vacuum"]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("ação de db inválida: vacuum");
  });

  test("flightdeckd db prune [--dry-run] imprime as contagens por tabela", async () => {
    const dir = tempDir();
    const dataDir = join(dir, "data");
    const { store } = fixture(join(dataDir, "flightdeck.db"));
    store.close();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32), dataDir }));
    const run = async (args: string[]) => {
      const out: string[] = [];
      let code = null as number | null;
      await runCli(args, {
        env: {},
        log: { log: (m) => out.push(m), error: (m) => out.push(m) },
        exit: (c) => {
          code = c;
        },
        onSignal: () => {},
        now: () => NOW,
      });
      return { code, out: out.join("\n") };
    };
    const simulated = await run(["db", "prune", "--dry-run", "--config", file]);
    expect(simulated.code).toBe(0);
    expect(simulated.out).toContain("simulação");
    expect(simulated.out).toContain("events: 6");
    expect(simulated.out).toContain("external_sessions: 1");
    const done = await run(["db", "prune", "--config", file]);
    expect(done.out).toContain("events: 6");
    const again = await run(["db", "prune", "--config", file]);
    expect(again.out).toContain("events: 0");
    expect(loadConfig(file).retention.eventsDays).toBe(90);
  });
});
