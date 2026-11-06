import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EventEnvelope } from "@flightdeck/protocol";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { newManager, waitFor } from "./helpers.ts";

/** A manager whose trust answer the test turns on and off, and the summaries it announces. */
function setup(initial: boolean) {
  let trusted = initial;
  const made = newManager({
    runtime: new FakeRuntime({ delayMs: 1 }),
    trust: () => ({ trusted }),
  });
  const heard: EventEnvelope[] = [];
  made.manager.watchSummaries((envelope) => void heard.push(envelope));
  return {
    ...made,
    heard,
    revoke: () => {
      trusted = false;
      made.manager.trustChanged();
    },
  };
}

const staleOf = (heard: EventEnvelope[], id: string) =>
  heard
    .map((e) => e.event)
    .filter((e) => e.type === "session.summary" && e.sessionId === id)
    .map((e) => (e.type === "session.summary" ? e.trustStale : undefined))
    .at(-1);

describe("trust-stale: a session that loaded a project's setup is told when its trust is revoked (issue #463)", () => {
  test("revoking marks the live sessions of the folder and counts them; the others are left alone", async () => {
    const { manager, project, root, start, heard, revoke } = setup(true);
    const inner = join(root, "other");
    mkdirSync(inner, { recursive: true });
    const here = await start({ cwd: project, prompt: "oi" });
    const there = await start({ cwd: inner, prompt: "oi" });
    await waitFor(() => manager.get(here.sessionId).status === "idle", { label: "idle" });
    expect(manager.staleSessions(project)).toBe(0);
    expect(staleOf(heard, here.sessionId)).toBeUndefined();
    revoke();
    expect(manager.staleSessions(project)).toBe(1);
    expect(manager.staleSessions(inner)).toBe(1);
    expect(staleOf(heard, here.sessionId)).toBe(true);
    expect(staleOf(heard, there.sessionId)).toBe(true);
  });

  test("a session that never loaded the setup is not stale, whatever happens to the trust", async () => {
    const { manager, project, start, heard, revoke } = setup(false);
    const created = await start({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(created.sessionId).status === "idle", { label: "idle" });
    revoke();
    expect(manager.staleSessions(project)).toBe(0);
    expect(staleOf(heard, created.sessionId)).toBeUndefined();
  });

  test("restarting it (close, then resume) runs it without the setup: it is no longer stale", async () => {
    const { manager, project, start, heard, revoke } = setup(true);
    const created = await start({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(created.sessionId).status === "idle", { label: "idle" });
    revoke();
    expect(manager.staleSessions(project)).toBe(1);
    await manager.close(created.sessionId);
    expect(manager.staleSessions(project)).toBe(0);
    await manager.resume(created.sessionId);
    await waitFor(() => manager.get(created.sessionId).status === "idle", { label: "idle again" });
    expect(manager.staleSessions(project)).toBe(0);
    expect(staleOf(heard, created.sessionId)).not.toBe(true);
  });

  test("a folder trusted again clears the mark", async () => {
    let trusted = true;
    const made = newManager({
      runtime: new FakeRuntime({ delayMs: 1 }),
      trust: () => ({ trusted }),
    });
    const created = await made.start({ cwd: made.project, prompt: "oi" });
    await waitFor(() => made.manager.get(created.sessionId).status === "idle", { label: "idle" });
    trusted = false;
    expect(made.manager.staleSessions(made.project)).toBe(1);
    trusted = true;
    expect(made.manager.staleSessions(made.project)).toBe(0);
  });
});
