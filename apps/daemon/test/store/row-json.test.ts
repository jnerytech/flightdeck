import { describe, expect, test } from "bun:test";
import { EventStore } from "../../src/store/event-store.ts";

const SECRET = "sk-secret-token-123";

function newStore(extra: { persona?: object } = {}) {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s1",
    name: null,
    cwd: "/x",
    status: "starting",
    permissionMode: "default",
    model: null,
    ...(extra.persona ? { persona: extra.persona as never } : {}),
  });
  return store;
}

const SNAPSHOT = {
  id: "p1",
  name: "Reviewer",
  icon: null,
  hash: null,
  append: "be careful",
  model: null,
  effort: null,
  tools: null,
};

describe("event store: JSON columns that do not fit", () => {
  test("an applied persona that is no persona reads as none applied", () => {
    const store = newStore();
    store.db.query("UPDATE sessions SET applied_persona = ?").run('{"id":5}');
    expect(store.appliedPersona("s1")).toBeNull();
    store.db.query("UPDATE sessions SET applied_persona = ?").run("{nope");
    expect(store.appliedPersona("s1")).toBeNull();
  });

  test("a session shows the applied persona, else the opened one, and an unreadable applied one falls through", () => {
    const store = newStore({ persona: SNAPSHOT });
    expect(store.requireSession("s1").persona).toEqual({ id: "p1", name: "Reviewer", icon: null });
    store.setAppliedPersona("s1", { id: "a", name: "Applied", icon: "x" });
    expect(store.requireSession("s1").persona?.id).toBe("a");
    store.db.query("UPDATE sessions SET applied_persona = ?").run("{nope");
    expect(store.requireSession("s1").persona?.id).toBe("p1");
  });

  test("the last reported mode is none when its payload does not fit", () => {
    const store = newStore();
    store.db
      .query(
        "INSERT INTO events (session_id, seq, ts, type, payload) VALUES ('s1', 1, 't', 'session.mode', ?)",
      )
      .run('{"permissionMode":5}');
    expect(store.lastMode("s1")).toBeNull();
  });

  test("the persona and agents a session opened with are read whole, and one that does not fit throws without its text", () => {
    const store = newStore({ persona: SNAPSHOT });
    expect(store.sessionPersona("s1")).toEqual(SNAPSHOT);
    for (const [column, read] of [
      ["persona", () => store.sessionPersona("s1")],
      ["agents", () => store.sessionAgents("s1")],
    ] as const) {
      store.db.query(`UPDATE sessions SET ${column} = ?`).run(`{"${SECRET}": ${SECRET}`);
      expect(read).toThrow(/not JSON/);
      store.db.query(`UPDATE sessions SET ${column} = ?`).run(`{"${SECRET}": 1}`);
      expect(read).toThrow(/does not fit/);
    }
  });
});
