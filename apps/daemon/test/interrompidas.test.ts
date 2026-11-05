import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { RESTART_REASON, SessionManager } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const HOUR = 3_600_000;

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

const boot = (store: EventStore, root: string) =>
  new SessionManager({
    store,
    runtime: new FakeRuntime({ delayMs: 1 }),
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
  });

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
});
