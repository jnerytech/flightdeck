import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageIndexer } from "../src/costs/usage-indexer.ts";
import { SessionFiles } from "../src/review/session-files.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { usageFixture } from "./usage-helpers.ts";

const TOKEN = "session-files-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const S = "bbbbbbbb-0000-4000-8000-000000000002";
const CWD = "/work/app";

/** The files fixtures in a fake `~/.claude/projects`, read by the usage indexer. */
async function indexed(db = new EventStore(":memory:").db) {
  const root = join(tempDir("fd-files-"), "projects");
  mkdirSync(join(root, "proj", S, "subagents"), { recursive: true });
  writeFileSync(join(root, "proj", `${S}.jsonl`), usageFixture("files-main.jsonl", CWD));
  writeFileSync(
    join(root, "proj", S, "subagents", "agent-1.jsonl"),
    usageFixture("files-subagent.jsonl", CWD),
  );
  const indexer = new UsageIndexer({
    db,
    roots: [root],
    projectKey: () => "k",
    pause: async () => {},
  });
  await indexer.pass();
  return { db, root, indexer, files: new SessionFiles({ db }) };
}

describe("sessao-arquivos", () => {
  test("Write, Edit, MultiEdit e NotebookEdit dos transcripts, subagentes com a sessão-mãe; Read e Bash não entram", async () => {
    const { files } = await indexed();
    expect(files.list(S)).toEqual([
      {
        path: `${CWD}/nb.ipynb`,
        edits: 1,
        firstAt: "2026-10-01T10:07:00.000Z",
        lastAt: "2026-10-01T10:07:00.000Z",
      },
      {
        path: `${CWD}/src/b.ts`,
        edits: 1,
        firstAt: "2026-10-01T10:06:00.000Z",
        lastAt: "2026-10-01T10:06:00.000Z",
      },
      {
        path: `${CWD}/src/a.ts`,
        edits: 2,
        firstAt: "2026-10-01T10:00:01.000Z",
        lastAt: "2026-10-01T10:05:00.000Z",
      },
      {
        path: `${CWD}/src/c.ts`,
        edits: 1,
        firstAt: "2026-10-01T10:03:00.000Z",
        lastAt: "2026-10-01T10:03:00.000Z",
      },
    ]);
  });

  test("reler os transcripts não duplica: cada chamada de ferramenta conta uma vez", async () => {
    const { db, files, indexer } = await indexed();
    db.run("DELETE FROM usage_files");
    await indexer.pass();
    expect(files.list(S).map((f) => [f.path, f.edits])).toEqual([
      [`${CWD}/nb.ipynb`, 1],
      [`${CWD}/src/b.ts`, 1],
      [`${CWD}/src/a.ts`, 2],
      [`${CWD}/src/c.ts`, 1],
    ]);
  });

  test("files.sessions: as sessões que mexeram num arquivo, com as datas e o título", async () => {
    const { db, files } = await indexed();
    db.query(
      `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
       VALUES (?, ?, 'Criar a e b', 'x', 'x', 1, 'external', 'f')`,
    ).run(S, CWD);
    expect(files.sessionsOf(`${CWD}/src/a.ts`)).toEqual([
      {
        claudeSessionId: S,
        edits: 2,
        firstAt: "2026-10-01T10:00:01.000Z",
        lastAt: "2026-10-01T10:05:00.000Z",
        title: "Criar a e b",
      },
    ]);
    expect(files.sessionsOf(`${CWD}/src/z.ts`)).toEqual([]);
  });

  test("a migração faz o indexador reler tudo, para os transcripts que já existiam", () => {
    const file = join(tempDir("fd-mig-"), "flightdeck.db");
    const index = MIGRATIONS.findIndex((m) => m.includes("CREATE TABLE session_files"));
    expect(index).toBeGreaterThan(0);
    const older = new Database(file);
    for (const migration of MIGRATIONS.slice(0, index)) older.exec(migration);
    older.exec(`PRAGMA user_version = ${index}`);
    older
      .query("INSERT INTO usage_files (path, size, offset, cwd) VALUES ('t.jsonl', 10, 10, '/x')")
      .run();
    older.close();
    const store = new EventStore(file);
    cleanups.push(() => store.close());
    expect((store.db.query("SELECT COUNT(*) AS n FROM usage_files").get() as { n: number }).n).toBe(
      0,
    );
  });

  test("files.sessions e session.files pelo protocolo", async () => {
    const { files } = await indexed();
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      sessionFiles: files,
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
    const sessions = await client.data<{ sessions: Array<{ claudeSessionId: string }> }>(
      "files.sessions",
      { path: `${CWD}/src/b.ts` },
    );
    expect(sessions?.sessions.map((s) => s.claudeSessionId)).toEqual([S]);
    const list = await client.data<{ files: unknown[] }>("session.files", { claudeSessionId: S });
    expect(list?.files.length ?? 0).toBe(4);
  });
});
