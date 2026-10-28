import { describe, expect, test } from "bun:test";
import { EventStore } from "../src/store/event-store.ts";

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
});
