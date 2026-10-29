import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventEnvelope, SessionEvent } from "@flightdeck/protocol";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { SessionManager, type SessionManagerOptions } from "../src/sessions/session-manager.ts";
import { EventStore } from "../src/store/event-store.ts";

export function tempDir(prefix = "fd-test-"): string {
  return realTempDir(prefix);
}

/** Allowed root with a `project` directory inside it. */
export function workspace(): { root: string; project: string } {
  const root = tempDir("fd-root-");
  const project = join(root, "project");
  mkdirSync(project);
  return { root, project };
}

export function newManager(overrides: Partial<SessionManagerOptions> = {}) {
  const { root, project } = workspace();
  const store = overrides.store ?? new EventStore(":memory:");
  const runtime = (overrides.runtime as FakeRuntime | undefined) ?? new FakeRuntime({ delayMs: 1 });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
    ...overrides,
  });
  return { manager, store, runtime, root, project };
}

export async function waitFor<T>(
  check: () => T | undefined | null | false,
  { timeoutMs = 3000, label = "condição" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout esperando ${label}`);
    await Bun.sleep(2);
  }
}

/**
 * Like `waitFor`, but returns `null` on timeout instead of throwing, so the test fails on the
 * `expect` that follows (an assertion), never on the wait itself (docs/TDD.md).
 */
export async function poll<T>(
  check: () => T | undefined | null | false,
  timeoutMs = 3000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await Bun.sleep(5);
  }
}

/** Subscribes from the start of a session and records every envelope. */
export function record(manager: SessionManager, sessionId: string, sinceSeq = 0) {
  const envelopes: EventEnvelope[] = [];
  const sub = manager.subscribe(sessionId, sinceSeq, (e) => envelopes.push(e));
  envelopes.push(...sub.replay);
  const events = () => envelopes.map((e) => e.event);
  const statuses = () => events().flatMap((e) => (e.type === "session.status" ? [e.status] : []));
  const count = (type: SessionEvent["type"]) => events().filter((e) => e.type === type).length;
  const find = <T extends SessionEvent["type"]>(type: T) =>
    events().filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type);
  return { envelopes, events, statuses, count, find, unsubscribe: sub.unsubscribe };
}
