import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliDeps, parseArgs, runCli } from "../src/main.ts";
import { EventStore } from "../src/store/event-store.ts";
import { poll, tempDir } from "./helpers.ts";
import {
  assistantLine,
  projectsRoot,
  summaryLine,
  userLine,
  writeTranscript,
} from "./history-helpers.ts";

function setup() {
  const root = projectsRoot();
  writeTranscript(root, "-a", "s-a", [
    userLine({ uuid: "u1", text: "um", cwd: "/a" }),
    assistantLine({ uuid: "a1", text: "dois", cwd: "/a" }),
    summaryLine("Sessão A", "a1"),
  ]);
  writeTranscript(root, "-b", "s-b", [
    userLine({ uuid: "u1", text: "três", cwd: "/b" }),
    "linha inválida",
    JSON.stringify({ type: "queue-operation", uuid: "q1", cwd: "/b" }),
  ]);
  const dir = tempDir();
  const dataDir = join(dir, "data");
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({ port: 0, token: "t".repeat(32), dataDir, history: { roots: [root] } }),
  );
  return { file, db: join(dataDir, "flightdeck.db") };
}

function deps() {
  const exits: number[] = [];
  const out: string[] = [];
  const errors: string[] = [];
  const cli: CliDeps = {
    env: {},
    log: { log: (m) => out.push(m), error: (m) => errors.push(m) },
    exit: (code) => exits.push(code),
    onSignal: () => {},
  };
  return { cli, exits, out, errors };
}

/** Messages, sessions and stored rows of every kind, read straight from the database file. */
function counts(dbPath: string) {
  const store = new EventStore(dbPath);
  const one = (sql: string) => (store.db.query(sql).get() as { n: number }).n;
  const result = {
    messages: one("SELECT COUNT(*) AS n FROM history_messages WHERE kind = 'message'"),
    rows: one("SELECT COUNT(*) AS n FROM history_messages"),
    sessions: one("SELECT COUNT(*) AS n FROM history_sessions"),
  };
  store.close();
  return result;
}

describe("reindex", () => {
  test("argumentos: history reindex [--config]", () => {
    expect(parseArgs(["history", "reindex", "--config", "c.json"])).toEqual({
      command: "history",
      action: "reindex",
      config: "c.json",
    });
    expect(() => parseArgs(["history", "apagar"])).toThrow("ação de histórico inválida");
  });

  test("history reindex apaga o índice e reconstrói com a mesma contagem de mensagens", async () => {
    const { file, db } = setup();
    const running = deps();
    const daemon = await runCli(["--config", file, "--runtime", "fake"], running.cli);
    expect(daemon).not.toBeNull();
    expect(await poll(() => running.out.includes("histórico: busca com FTS5"))).toBe(true);
    // Wait for the boot pass: 3 messages in 2 sessions.
    let before = { messages: 0, rows: 0, sessions: 0 };
    for (let i = 0; i < 100 && before.messages < 3; i++) {
      before = counts(db);
      if (before.messages < 3) await Bun.sleep(20);
    }
    await daemon?.stop();
    expect(before).toEqual({ messages: 3, rows: 5, sessions: 2 });

    // A damaged index: rows lost, a stale session left behind.
    const damaged = new EventStore(db);
    damaged.db.run("DELETE FROM history_messages WHERE uuid = 'u1'");
    damaged.db.run(
      "INSERT INTO history_sessions (claude_session_id, cwd, message_count) VALUES ('fantasma', '/x', 9)",
    );
    damaged.close();

    const cli = deps();
    expect(await runCli(["history", "reindex", "--config", file], cli.cli)).toBeNull();
    expect(cli.exits).toEqual([0]);
    expect(cli.out.at(-1)).toBe("histórico reconstruído: 2 sessões, 3 mensagens");
    expect(counts(db)).toEqual(before);

    // The rebuilt index serves search like before.
    const search = new EventStore(db);
    const hits = search.db
      .query("SELECT COUNT(*) AS n FROM history_fts WHERE history_fts MATCH 'três'")
      .get() as { n: number };
    search.close();
    expect(hits.n).toBe(1);
  });

  test("com o daemon rodando no mesmo dataDir o reindex recusa e sai com código 3", async () => {
    const { file } = setup();
    const running = deps();
    const daemon = await runCli(["--config", file, "--runtime", "fake"], running.cli);
    const cli = deps();
    await runCli(["history", "reindex", "--config", file], cli.cli);
    await daemon?.stop();
    expect(cli.exits).toEqual([3]);
    expect(cli.errors.join("\n")).toContain("pare o daemon");
  });
});
