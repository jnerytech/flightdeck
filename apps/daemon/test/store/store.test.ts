import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { tempDir } from "./helpers.ts";

function newStore() {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s1",
    name: null,
    cwd: "/x",
    status: "starting",
    permissionMode: "default",
    model: null,
  });
  return store;
}

describe("store", () => {
  test("open makes the folder of the database file, then opens it", async () => {
    const path = join(tempDir("fd-store-"), "a", "b", "flightdeck.db");
    const store = await EventStore.open(path);
    expect(existsSync(path)).toBe(true);
    store.close();
  });

  test("seq cresce por sessão e last_seq acompanha", () => {
    const store = newStore();
    const a = store.appendEvent("s1", { type: "message.user", text: "a" });
    const b = store.appendEvent("s1", { type: "message.user", text: "b" });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(store.requireSession("s1").lastSeq).toBe(2);
  });

  test("message.delta não é persistido e carrega o last_seq atual", () => {
    const store = newStore();
    store.appendEvent("s1", { type: "message.user", text: "a" });
    const delta = store.appendEvent("s1", { type: "message.delta", text: "x" });
    expect(delta.seq).toBe(1);
    expect(store.eventsSince("s1", 0).map((e) => e.event.type)).toEqual(["message.user"]);
  });

  test("eventsSince devolve só eventos depois de sinceSeq, em ordem", () => {
    const store = newStore();
    for (const t of ["a", "b", "c"]) store.appendEvent("s1", { type: "message.user", text: t });
    expect(store.eventsSince("s1", 1).map((e) => e.seq)).toEqual([2, 3]);
  });

  test("evento inválido é recusado", () => {
    const store = newStore();
    // biome-ignore lint/suspicious/noExplicitAny: testing runtime validation
    expect(() => store.appendEvent("s1", { type: "bogus" } as any)).toThrow();
  });

  test("permissão só resolve uma vez", () => {
    const store = newStore();
    store.createPermission({ id: "p1", sessionId: "s1", toolName: "Write", input: { a: 1 } });
    expect(store.pendingPermissions("s1")).toHaveLength(1);
    expect(store.resolvePermission("p1", "allowed")).toBe(true);
    expect(store.resolvePermission("p1", "denied")).toBe(false);
    expect(store.getPermission("p1")?.status).toBe("allowed");
  });

  test("a database from before the runtime column gets it on open: its sessions are Claude's, and a new one can be OpenCode's (issue #250)", () => {
    const file = join(tempDir("fd-store-"), "flightdeck.db");
    const index = MIGRATIONS.findIndex((m) => m.includes("ADD COLUMN runtime"));
    expect(index).toBeGreaterThan(0);
    const older = new Database(file);
    for (const migration of MIGRATIONS.slice(0, index)) older.exec(migration);
    older.exec(`PRAGMA user_version = ${index}`);
    older
      .query(
        `INSERT INTO sessions (id, name, cwd, status, permission_mode, model, last_seq, created_at, updated_at)
         VALUES ('old', 'velha', '/x', 'idle', 'default', NULL, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    expect(
      older
        .query("PRAGMA table_info(sessions)")
        .all()
        .map((c) => (c as { name: string }).name),
    ).not.toContain("runtime");
    older.close();
    const store = new EventStore(file);
    try {
      expect(store.getSession("old")?.runtime).toBe("claude");
      store.createSession({
        id: "new",
        name: null,
        cwd: "/y",
        status: "idle",
        permissionMode: "default",
        model: null,
        runtime: "opencode",
      });
      expect(store.getSession("new")?.runtime).toBe("opencode");
      expect(store.getSession("old")?.runtime).toBe("claude");
      expect(store.db.query("PRAGMA user_version").get()).toEqual({
        user_version: MIGRATIONS.length,
      });
    } finally {
      store.close();
    }
  });
});
