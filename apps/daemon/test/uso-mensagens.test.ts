import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UsageIndexer, type UsageIndexerOptions } from "../src/costs/usage-indexer.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";
import {
  type EntryRow,
  insertCard,
  insertCardRun,
  insertSession,
  insertStepRun,
  SESSION,
  usageEntries,
  writeUsageTranscript,
} from "./usage-helpers.ts";

/** The host is at UTC−3: 01:30 UTC is still the day before there. */
const minus3 = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);

/** A store, a fake `~/.claude/projects` and an indexer over it with injected key, day and cost. */
function setup(overrides: Partial<UsageIndexerOptions> = {}) {
  const store = new EventStore(":memory:");
  const root = join(tempDir("fd-usage-"), "projects");
  mkdirSync(root);
  const indexer = new UsageIndexer({
    db: store.db,
    roots: [root],
    projectKey: (cwd) => `k:${basename(cwd)}`,
    day: minus3,
    cost: (t) => (t.model === "claude-mystery-9" ? null : t.input + t.output),
    pause: async () => {},
    ...overrides,
  });
  return { db: store.db, root, indexer };
}

const row = (fields: Partial<EntryRow>): EntryRow => ({
  message_id: "",
  at: "",
  model: "",
  input: 0,
  output: 0,
  cost_usd: null,
  claude_session_id: SESSION,
  day: "2026-10-01",
  project_key: "k:app",
  origin: "terminal",
  speed: "standard",
  cache_read: 0,
  cache_write_5m: 0,
  cache_write_1h: 0,
  ...fields,
});

describe("uso-mensagens", () => {
  test("uma mensagem em várias linhas conta uma vez; a subagente entra com a sessão-mãe; dia no fuso injetado", async () => {
    const { db, root, indexer } = setup();
    writeUsageTranscript(root, "proj", "/work/app");
    expect(await indexer.pass()).toBe(5);
    expect(usageEntries(db)).toEqual([
      row({
        message_id: "msg_A",
        at: "2026-10-01T12:00:05.000Z",
        model: "claude-opus-5-5",
        input: 100,
        output: 50,
        cache_read: 1000,
        cache_write_5m: 100,
        cache_write_1h: 200,
        cost_usd: 150,
      }),
      row({
        message_id: "msg_B",
        at: "2026-10-01T12:01:00.000Z",
        model: "claude-opus-5-5",
        speed: "fast",
        input: 10,
        output: 20,
        cost_usd: 30,
      }),
      // No `cache_creation` split: everything counts as the 5-minute cache.
      row({
        message_id: "msg_C",
        at: "2026-10-02T01:30:00.000Z",
        model: "claude-sonnet-5-5",
        input: 5,
        output: 5,
        cache_write_5m: 400,
        cost_usd: 10,
      }),
      row({
        message_id: "msg_D",
        at: "2026-10-01T12:03:00.000Z",
        model: "claude-mystery-9",
        input: 7,
        output: 3,
        cost_usd: null,
      }),
      row({
        message_id: "msg_S1",
        at: "2026-10-01T12:02:00.000Z",
        model: "claude-haiku-5-5",
        origin: "subagent",
        input: 2000,
        output: 100,
        cost_usd: 2100,
      }),
    ]);
  });

  test("reler o arquivo não duplica: só as mensagens novas entram, também depois de um arquivo menor", async () => {
    const { db, root, indexer } = setup();
    const { main } = writeUsageTranscript(root, "proj", "/work/app");
    await indexer.pass();
    expect(await indexer.pass()).toBe(0);
    const lines = readFileSync(main, "utf8").split("\n").filter(Boolean);
    const repeated = lines[5] as string;
    const fresh = repeated.replace('"id":"msg_B"', '"id":"msg_F"');
    appendFileSync(main, `${repeated}\n${fresh}\n`);
    expect(await indexer.pass()).toBe(1);
    // Swapped for a shorter file: read again from the start, still nothing twice.
    writeFileSync(main, `${lines[1]}\n`);
    expect(await indexer.pass()).toBe(0);
    expect(usageEntries(db).map((e) => e.message_id)).toEqual([
      "msg_A",
      "msg_B",
      "msg_C",
      "msg_D",
      "msg_F",
      "msg_S1",
    ]);
  });

  test("origin certo para app, card e workflow, com o projeto do card mesmo sem o worktree", async () => {
    const { db, root, indexer } = setup();
    const ids = { app: "s-app", card: "s-card", workflow: "s-wf" };
    insertSession(db, "m-app", ids.app, "/work/app");
    insertSession(db, "m-card", ids.card, "/gone/worktrees/card-1");
    insertSession(db, "m-wf", ids.workflow, "/gone/worktrees/card-2");
    insertCard(db, "c-1", "p-1", "/repos/loja");
    insertCard(db, "c-2", "p-1", "/repos/loja");
    insertCardRun(db, "r-1", "c-1", "m-card");
    insertCardRun(db, "r-2", "c-2", "m-wf");
    insertStepRun(db, "r-2", "c-2", "m-wf");
    writeUsageTranscript(root, "a", "/work/app", { id: ids.app, prefix: "app", subagent: false });
    writeUsageTranscript(root, "b", "/gone/worktrees/card-1", { id: ids.card, prefix: "card" });
    writeUsageTranscript(root, "c", "/gone/worktrees/card-2", {
      id: ids.workflow,
      prefix: "wf",
      subagent: false,
    });
    await indexer.pass();
    const of = (id: string) =>
      usageEntries(db)
        .filter((e) => e.message_id === id)
        .map((e) => [e.claude_session_id, e.origin, e.project_key]);
    expect(of("msg_appA")).toEqual([["s-app", "app", "k:app"]]);
    expect(of("msg_cardA")).toEqual([["s-card", "card", "k:loja"]]);
    expect(of("msg_cardS1")).toEqual([["s-card", "subagent", "k:loja"]]);
    expect(of("msg_wfA")).toEqual([["s-wf", "workflow", "k:loja"]]);
  });

  test("terminal vira app quando a sessão gerenciada ganha o claudeSessionId depois", async () => {
    const { db, root, indexer } = setup();
    writeUsageTranscript(root, "proj", "/work/app", { subagent: false });
    await indexer.pass();
    insertSession(db, "m-1", SESSION, "/work/app");
    await indexer.pass();
    expect([...new Set(usageEntries(db).map((e) => e.origin))]).toEqual(["app"]);
  });

  test("transcripts de pastas excluídas não entram", async () => {
    const { db, root, indexer } = setup({ excludeCwds: ["/work/secreto"] });
    writeUsageTranscript(root, "proj", "/work/secreto/sub");
    writeUsageTranscript(root, "other", "/work/app", { id: "s-2", prefix: "x", subagent: false });
    await indexer.pass();
    expect([...new Set(usageEntries(db).map((e) => e.claude_session_id))]).toEqual(["s-2"]);
  });

  test("raiz inexistente e pasta de sessão sem subagents/ não interrompem a passada", async () => {
    const { db, root, indexer } = setup();
    const missing = join(root, "..", "nao-existe");
    const other = new UsageIndexer({ ...indexer.opts, roots: [missing, root] });
    writeUsageTranscript(root, "proj", "/work/app", { subagent: false });
    mkdirSync(join(root, "proj", "outra-sessao", "tool-results"), { recursive: true });
    expect(await other.pass().catch(() => -1)).toBe(4);
    expect(usageEntries(db)).toHaveLength(4);
  });
});
