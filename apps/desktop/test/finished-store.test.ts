import { describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { sinceLastLook } from "../src/lib/finished.ts";
import { memoryPlatform } from "./fixtures.ts";

const T0 = Date.parse("2026-11-08T10:00:00.000Z");

/** A store with one host, a clock the test drives, and `changes.get` answering what the test sets. */
function world(focused = false) {
  const mem = memoryPlatform(focused, "en");
  const clock = { now: T0 };
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000, now: () => clock.now });
  store.i18n.start();
  const internals = store as unknown as {
    update(patch: object): void;
    onSummary(hostId: string, summary: object): void;
  };
  internals.update({
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "offline",
        info: null,
        hostInfo: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
  });
  /** The Claude session id the app knows for each managed session (it comes with the session's events). */
  const known = (id: string, claudeSessionId: string) =>
    internals.update({
      sessions: { ...store.getState().sessions, [`h1/${id}`]: { items: [], claudeSessionId } },
    });
  const changes = { files: null as number | null, asked: [] as string[] };
  store.hostRequest = (async (_host: string, type: string, payload: { target?: string }) => {
    if (type !== "changes.get") return { ok: false, code: "unknown", message: type };
    changes.asked.push(payload.target ?? "");
    return changes.files === null
      ? { ok: false, code: "internal", message: "no repository" }
      : { ok: true, data: { files: Array.from({ length: changes.files }, () => ({})) } };
  }) as unknown as typeof store.hostRequest;
  const summary = (id: string, status: string) =>
    internals.onSummary("h1", {
      type: "session.summary",
      sessionId: id,
      name: `sessao-${id}`,
      cwd: "/work/api",
      status,
      pendingPermissions: [],
      updatedAt: "2026-11-08T10:00:00Z",
    });
  return { store, mem, clock, changes, summary, known };
}

describe("finished-store: what finished since the last look (issue #1134)", () => {
  test("a turn that ends is one finish, kept for the next run, however many times the status repeats", () => {
    const w = world();
    w.summary("s1", "running");
    w.clock.now = T0 + 60_000;
    w.summary("s1", "idle");
    w.summary("s1", "idle");
    const [finish, ...rest] = w.store.getState().finished;
    expect(rest).toEqual([]);
    expect(finish).toMatchObject({
      key: "h1/s1",
      hostId: "h1",
      sessionId: "s1",
      name: "sessao-s1",
      outcome: "done",
      at: new Date(T0 + 60_000).toISOString(),
    });
    expect(w.mem.items.get("flightdeck.finished")).toContain('"sessionId":"s1"');
  });

  test("a failed turn and an ended session finish too; the first sight of a session does not", () => {
    const w = world();
    w.summary("seen-first", "idle");
    w.summary("a", "running");
    w.summary("a", "error");
    w.summary("b", "idle");
    w.summary("b", "ended");
    const outcomes = Object.fromEntries(
      w.store.getState().finished.map((f) => [f.sessionId, f.outcome]),
    );
    expect(outcomes).toEqual({ a: "failed", b: "ended" });
  });

  test("the files it changed are asked of the host by the session's Claude id, and shown when known", async () => {
    const w = world();
    w.changes.files = 3;
    w.known("s1", "claude-abc");
    w.summary("s1", "running");
    w.summary("s1", "idle");
    await Promise.resolve();
    await Promise.resolve();
    expect(w.changes.asked).toEqual(["session:claude-abc"]);
    expect(w.store.getState().finished[0]?.files).toBe(3);
  });

  test("a session whose Claude id is not known yet is not asked about", async () => {
    const w = world();
    w.changes.files = 3;
    w.summary("s1", "running");
    w.summary("s1", "idle");
    await Promise.resolve();
    await Promise.resolve();
    expect(w.changes.asked).toEqual([]);
    expect(w.store.getState().finished[0]?.files).toBeNull();
  });

  test("a host that cannot say leaves the count unknown", async () => {
    const w = world();
    w.known("s1", "claude-abc");
    w.summary("s1", "running");
    w.summary("s1", "idle");
    await Promise.resolve();
    await Promise.resolve();
    expect(w.store.getState().finished[0]?.files).toBeNull();
  });

  test("looking clears the list, and the next finish is the only new one", () => {
    const w = world();
    w.summary("s1", "running");
    w.clock.now = T0 + 1000;
    w.summary("s1", "idle");
    const state = () => w.store.getState();
    expect(sinceLastLook(state().finished, state().finishedLook)).toHaveLength(1);
    w.clock.now = T0 + 2000;
    w.store.finishedSeen();
    expect(state().finishedLook).toBe(new Date(T0 + 2000).toISOString());
    expect(sinceLastLook(state().finished, state().finishedLook)).toEqual([]);
    expect(w.mem.items.get("flightdeck.finished")).toContain(new Date(T0 + 2000).toISOString());
    w.summary("s2", "running");
    w.clock.now = T0 + 3000;
    w.summary("s2", "idle");
    expect(sinceLastLook(state().finished, state().finishedLook).map((f) => f.sessionId)).toEqual([
      "s2",
    ]);
  });

  test("a finish notifies once, and not while the app has focus", () => {
    const away = world(false);
    away.summary("s1", "running");
    away.summary("s1", "idle");
    away.summary("s1", "idle");
    expect(away.mem.notifications).toHaveLength(1);
    const here = world(true);
    here.summary("s1", "running");
    here.summary("s1", "idle");
    expect(here.mem.notifications).toEqual([]);
    expect(here.store.getState().finished).toHaveLength(1);
  });
});
