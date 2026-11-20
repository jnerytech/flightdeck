import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { packPersonas } from "../../src/personas/index.ts";
import { Personas } from "../../src/personas/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { MIGRATIONS } from "../../src/store/migrations.ts";
import { scanner } from "../personas/model-setup.ts";
import { tempDir, workspace } from "../support/helpers.ts";

// #3413: the four Portuguese pack persona ids are English ones in what a database already holds.
const AT = "2026-01-01T00:00:00.000Z";
const BADGE = (id: string) => JSON.stringify({ id, name: "N", icon: null });
const SNAPSHOT = (id: string, hash: string | null) =>
  JSON.stringify({
    id,
    name: "N",
    icon: null,
    hash,
    append: "text",
    model: null,
    effort: null,
    tools: null,
  });
const EDITED = (id: string) =>
  JSON.stringify({
    id,
    name: "Edited",
    description: "A host edit of a pack persona",
    icon: null,
    model: null,
    effort: null,
    tools: null,
    permissionMode: null,
    body: "Edited text.",
  });

/** A database as it was before the migration, filled with the old ids. */
function olderDatabase(): { file: string; index: number } {
  const file = join(tempDir("fd-persona-ids-"), "flightdeck.db");
  const index = MIGRATIONS.findIndex((m) => m.includes("#3413"));
  expect(index).toBeGreaterThan(0);
  const db = new Database(file);
  for (const migration of MIGRATIONS.slice(0, index)) db.exec(migration);
  db.exec(`PRAGMA user_version = ${index}`);
  const run = (sql: string, ...params: unknown[]) => db.query(sql).run(...(params as never[]));
  run(
    "INSERT INTO personas (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    "revisor",
    EDITED("revisor"),
    AT,
    AT,
  );
  run(
    "INSERT INTO personas (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    "security",
    EDITED("security"),
    AT,
    AT,
  );
  run(
    "INSERT INTO personas (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
    "seguranca",
    EDITED("seguranca"),
    AT,
    AT,
  );
  const session = (id: string, persona: string | null, applied: string | null) =>
    run(
      `INSERT INTO sessions (id, cwd, status, permission_mode, created_at, updated_at, persona, applied_persona)
       VALUES (?, '/x', 'idle', 'default', ?, ?, ?, ?)`,
      id,
      AT,
      AT,
      persona,
      applied,
    );
  session("opened", SNAPSHOT("revisor", null), BADGE("revisor"));
  session("from-project", SNAPSHOT("revisor", "abc123"), null);
  session("untouched", SNAPSHOT("qa", null), BADGE("qa"));
  run(
    `INSERT INTO external_sessions (claude_session_id, status, started_at, last_event_at, persona_open, persona_applied)
     VALUES ('ext', 'idle', ?, ?, ?, ?)`,
    AT,
    AT,
    BADGE("arquiteto"),
    BADGE("coordenador"),
  );
  run(
    `INSERT INTO projects (id, path, name, base_branch, pr_provider, prompt_template, persona_by_column)
     VALUES ('p', '/p', 'p', 'main', 'github', 't', ?)`,
    JSON.stringify({ review: "revisor", backlog: null, doing: "qa" }),
  );
  run(
    `INSERT INTO cards (id, project_id, title, description, board_column, position, created_at, updated_at, start_persona)
     VALUES ('c', 'p', 't', 'd', 'backlog', 1, ?, ?, 'arquiteto')`,
    AT,
    AT,
  );
  run(
    "INSERT INTO card_runs (id, card_id, queued_at, persona) VALUES ('r1', 'c', ?, ?)",
    AT,
    JSON.stringify({ id: "seguranca", language: "en" }),
  );
  run("INSERT INTO card_runs (id, card_id, queued_at, persona) VALUES ('r2', 'c', ?, ?)", AT, null);
  db.close();
  return { file, index };
}

const rows = (store: EventStore, sql: string) => store.db.query(sql).all();

describe("persona ids that were Portuguese, in a database (#3413)", () => {
  test("every stored id becomes the English one, and a second open changes nothing", () => {
    const { file } = olderDatabase();
    const snapshot = (store: EventStore) => ({
      personas: rows(store, "SELECT id, data FROM personas ORDER BY id"),
      sessions: rows(store, "SELECT id, persona, applied_persona FROM sessions ORDER BY id"),
      external: rows(store, "SELECT persona_open, persona_applied FROM external_sessions"),
      column: rows(store, "SELECT persona_by_column FROM projects"),
      start: rows(store, "SELECT start_persona FROM cards"),
      runs: rows(store, "SELECT id, persona FROM card_runs ORDER BY id"),
    });
    const first = new EventStore(file);
    const after = snapshot(first);
    first.close();
    const second = new EventStore(file);
    const again = snapshot(second);
    second.close();
    expect(again).toEqual(after);
    expect(after.sessions).toEqual([
      { id: "from-project", persona: SNAPSHOT("revisor", "abc123"), applied_persona: null },
      { id: "opened", persona: SNAPSHOT("reviewer", null), applied_persona: BADGE("reviewer") },
      { id: "untouched", persona: SNAPSHOT("qa", null), applied_persona: BADGE("qa") },
    ]);
    expect(after.external).toEqual([
      { persona_open: BADGE("architect"), persona_applied: BADGE("coordinator") },
    ]);
    expect(after.start).toEqual([{ start_persona: "architect" }]);
    expect(after.runs).toEqual([
      { id: "r1", persona: JSON.stringify({ id: "security", language: "en" }) },
      { id: "r2", persona: null },
    ]);
    expect(
      JSON.parse((after.column[0] as { persona_by_column: string }).persona_by_column),
    ).toEqual({
      review: "reviewer",
      backlog: null,
      doing: "qa",
    });
  });

  test("a host edit of a pack persona keeps its edit under the new id and its JSON id follows", async () => {
    const { file } = olderDatabase();
    const store = new EventStore(file);
    try {
      const { root } = workspace();
      const personas = new Personas({
        db: store.db,
        allowedRoots: [root],
        scanner,
        pack: packPersonas,
      });
      const hostViews = (await personas.list({ scope: "host", language: "en" })).personas;
      const reviewer = hostViews.find((view) => view.id === "reviewer");
      expect([reviewer?.name, reviewer?.modified, reviewer?.scope]).toEqual([
        "Edited",
        true,
        "host",
      ]);
      // The old id still resolves, to the same persona.
      expect((await personas.get("revisor", { language: "en" })).name).toBe("Edited");
    } finally {
      store.close();
    }
  });

  test("a new id the person already made is left as it is, and the old row stays", () => {
    const { file } = olderDatabase();
    const store = new EventStore(file);
    try {
      expect(rows(store, "SELECT id FROM personas ORDER BY id")).toEqual([
        { id: "reviewer" },
        { id: "security" },
        { id: "seguranca" },
      ]);
      const security = store.db.query("SELECT data FROM personas WHERE id = 'security'").get() as {
        data: string;
      };
      expect(JSON.parse(security.data).id).toBe("security");
    } finally {
      store.close();
    }
  });
});
