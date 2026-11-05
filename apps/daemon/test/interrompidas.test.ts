import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { RESTART_REASON, SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

const booted: SessionManager[] = [];
afterEach(async () => {
  for (const manager of booted.splice(0)) await manager.shutdown();
});

/** A store a daemon left behind: sessions in several states, some with a request and a past restart. */
function crashed() {
  const dir = tempDir();
  const root = tempDir("fd-root-");
  const project = join(root, "p");
  mkdirSync(project);
  const store = new EventStore(join(dir, "flightdeck.db"));
  const add = (
    id: string,
    status: "running" | "awaiting_permission" | "idle" | "ended",
    name?: string,
  ) => {
    store.createSession({
      id,
      name: name ?? null,
      cwd: project,
      status,
      permissionMode: "default",
      model: null,
    });
    store.updateSession(id, { claudeSessionId: `claude-${id}` });
  };
  add("running-1", "running", "Revisar o login");
  add("waiting-1", "awaiting_permission");
  add("idle-1", "idle");
  add("ended-1", "ended");
  store.appendEvent("running-1", { type: "message.user", text: "revisar o fluxo de login" });
  return { dir, root, project, store };
}

const boot = (store: EventStore, root: string) => {
  const manager = new SessionManager({
    store,
    runtime: new FakeRuntime({ delayMs: 1 }),
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
  });
  booted.push(manager);
  return manager;
};

/** When the restart marked a session, as the offer reports it. */
const markedAt = (manager: SessionManager, sessionId: string): number => {
  const found = manager.interrupted().find((s) => s.sessionId === sessionId);
  return Date.parse(found?.interruptedAt ?? "");
};

describe("interrompidas: the sessions a daemon restart interrupted, for the resume offer (issue #150)", () => {
  test("a restart lists exactly the sessions it interrupted, with name, folder, how long they ran and their last request", () => {
    const { store, root, project } = crashed();
    const manager = boot(store, root);
    const listed = manager.interrupted();
    expect(listed.map((s) => s.sessionId).sort()).toEqual(["running-1", "waiting-1"]);
    const running = listed.find((s) => s.sessionId === "running-1");
    expect(running).toMatchObject({
      name: "Revisar o login",
      cwd: project,
      persona: null,
      lastRequest: "revisar o fluxo de login",
    });
    expect(running?.ranMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(running?.interruptedAt ?? "")).toBeGreaterThan(0);
    expect(listed.find((s) => s.sessionId === "waiting-1")?.lastRequest).toBeNull();
  });

  test("the restart has a machine code, and rows left with the old Portuguese reason are listed too", () => {
    expect(RESTART_REASON).toBe("daemon_restarted");
    const { store, root } = crashed();
    // A row an older daemon marked: error with the sentence it used to write.
    store.createSession({
      id: "old-1",
      name: null,
      cwd: tempDir(),
      status: "error",
      permissionMode: "default",
      model: null,
    });
    store.appendEvent("old-1", {
      type: "session.status",
      status: "error",
      reason: "daemon reiniciado",
    });
    const manager = boot(store, root);
    expect(manager.interrupted().map((s) => s.sessionId)).toContain("old-1");
  });

  test("what was interrupted more than 24 hours ago, was resumed since, or ended on its own is not offered", async () => {
    const { store, root } = crashed();
    const manager = boot(store, root);
    await manager.resume("waiting-1");
    expect(manager.interrupted().map((s) => s.sessionId)).toEqual(["running-1"]);
    const later = Date.now() + 25 * HOUR;
    expect(manager.interrupted({ now: later })).toEqual([]);
    expect(
      manager.interrupted({ now: later, withinMs: 48 * HOUR }).map((s) => s.sessionId),
    ).toEqual(["running-1"]);
  });

  test("a session that failed by itself (not by a restart) is not offered", () => {
    const { store, root } = crashed();
    store.createSession({
      id: "failed-1",
      name: null,
      cwd: tempDir(),
      status: "error",
      permissionMode: "default",
      model: null,
    });
    store.appendEvent("failed-1", {
      type: "session.status",
      status: "error",
      reason: "the runtime fell over",
    });
    expect(
      boot(store, root)
        .interrupted()
        .map((s) => s.sessionId),
    ).not.toContain("failed-1");
  });
  test("a session that failed by itself is told apart from the restart ones in the same store", () => {
    const { store, root } = crashed();
    store.createSession({
      id: "failed-1",
      name: null,
      cwd: tempDir(),
      status: "error",
      permissionMode: "default",
      model: null,
    });
    store.updateSession("failed-1", { claudeSessionId: "claude-failed-1" });
    store.appendEvent("failed-1", {
      type: "session.status",
      status: "error",
      reason: "the runtime fell over",
    });
    const ids = boot(store, root)
      .interrupted()
      .map((s) => s.sessionId);
    // The control: the restart ones are listed, so the failed one's absence is the filter at work.
    expect(ids.sort()).toEqual(["running-1", "waiting-1"]);
  });

  test("a resumed session that later fails by itself leaves the offer", async () => {
    const { store, root } = crashed();
    const manager = boot(store, root);
    await manager.resume("waiting-1");
    store.appendEvent("waiting-1", {
      type: "session.status",
      status: "error",
      reason: "the runtime fell over",
    });
    store.updateSession("waiting-1", { status: "error" });
    expect(manager.interrupted().map((s) => s.sessionId)).toEqual(["running-1"]);
  });

  test("a session that never got a Claude session id cannot be resumed, so it is not offered", () => {
    const { store, root, project } = crashed();
    store.createSession({
      id: "starting-1",
      name: "never started",
      cwd: project,
      status: "starting",
      permissionMode: "default",
      model: null,
    });
    const manager = boot(store, root);
    expect(manager.get("starting-1").status).toBe("error");
    expect(manager.interrupted().map((s) => s.sessionId)).not.toContain("starting-1");
  });

  test("the window is inclusive: 23h59 and exactly 24h are offered, 24h and 1 ms is not", () => {
    const { store, root } = crashed();
    const manager = boot(store, root);
    const at = markedAt(manager, "running-1");
    const offered = (now: number) => manager.interrupted({ now }).map((s) => s.sessionId);
    expect(offered(at + 24 * HOUR - MINUTE)).toContain("running-1");
    expect(offered(at + 24 * HOUR)).toContain("running-1");
    expect(offered(at + 24 * HOUR + 1)).not.toContain("running-1");
  });

  test("a wider window brings back what the default one drops", () => {
    const { store, root } = crashed();
    const manager = boot(store, root);
    const at = markedAt(manager, "running-1");
    const now = at + 25 * HOUR;
    expect(manager.interrupted({ now })).toEqual([]);
    expect(manager.interrupted({ now, withinMs: 48 * HOUR }).map((s) => s.sessionId)).toContain(
      "running-1",
    );
  });

  test("how long it ran is the time from its start to the restart mark", () => {
    const { store, root } = crashed();
    const manager = boot(store, root);
    const listed = manager.interrupted().find((s) => s.sessionId === "running-1");
    const created = Date.parse(manager.get("running-1").createdAt);
    expect(listed?.ranMs).toBe(Date.parse(listed?.interruptedAt ?? "") - created);
  });

  test("the last request wins, and it is cut at 200 characters without splitting an emoji", () => {
    const { store, root } = crashed();
    store.appendEvent("running-1", { type: "message.user", text: "first ask" });
    store.appendEvent("running-1", { type: "message.user", text: `${"a".repeat(199)}😀tail` });
    const listed = boot(store, root)
      .interrupted()
      .find((s) => s.sessionId === "running-1");
    expect(listed?.lastRequest).toBe("a".repeat(199));
  });

  test("an empty store offers nothing", () => {
    const store = new EventStore(join(tempDir(), "flightdeck.db"));
    expect(boot(store, tempDir()).interrupted()).toEqual([]);
  });

  test("two restarts in a row: the session is offered once, with the latest mark", () => {
    const { store, root } = crashed();
    const first = boot(store, root);
    const firstAt = markedAt(first, "running-1");
    // The second boot finds nothing active (the first already marked them) and adds no new mark.
    const second = boot(store, root);
    const ids = second.interrupted().map((s) => s.sessionId);
    expect(ids.filter((id) => id === "running-1")).toHaveLength(1);
    expect(markedAt(second, "running-1")).toBe(firstAt);
  });
});
