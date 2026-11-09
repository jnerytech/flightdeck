import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope, SessionEventOf } from "@flightdeck/protocol";
import { newManager, poll } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function idleSession() {
  const ctx = newManager();
  const { sessionId } = await ctx.manager.create({ cwd: ctx.project, prompt: "hello" });
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  cleanups.push(() => ctx.manager.close(sessionId));
  return { ...ctx, sessionId };
}

const summaryOf = (envelope: EventEnvelope, id: string) =>
  envelope.event.type === "session.summary" && envelope.event.sessionId === id
    ? (envelope.event as SessionEventOf<"session.summary">)
    : null;

describe("stall in the session manager (issue #1478)", () => {
  test("every event, a delta too, moves the session's last activity", async () => {
    const { manager, sessionId } = await idleSession();
    const first = manager.activity(sessionId).lastEventAt;
    expect(first).not.toBeNull();
    await Bun.sleep(5); // timing: the clock under test has millisecond resolution
    manager.send(sessionId, "again");
    await poll(() => manager.get(sessionId).status === "idle");
    expect(manager.activity(sessionId).lastEventAt ?? 0).toBeGreaterThan(first ?? 0);
  });

  test("a session marked quiet lists when and with which tool, and says so to the watchers", async () => {
    const { manager, sessionId } = await idleSession();
    const seen: Array<ReturnType<typeof summaryOf>> = [];
    manager.watchSummaries((envelope) => seen.push(summaryOf(envelope, sessionId)));
    manager.markQuiet(sessionId, { since: "2026-11-09T12:05:00.000Z", tool: "Bash" });
    const listed = manager.list().find((s) => s.id === sessionId);
    expect(listed?.quietSince).toBe("2026-11-09T12:05:00.000Z");
    expect(listed?.quietTool).toBe("Bash");
    const told = seen.filter((s) => s !== null).at(-1);
    expect(told?.quietSince).toBe("2026-11-09T12:05:00.000Z");
    expect(told?.quietTool).toBe("Bash");
  });

  test("the next event clears it at once, and the watchers are told", async () => {
    const { manager, sessionId } = await idleSession();
    manager.markQuiet(sessionId, { since: "2026-11-09T12:05:00.000Z", tool: null });
    expect(manager.list().find((s) => s.id === sessionId)?.quietSince).toBe(
      "2026-11-09T12:05:00.000Z",
    );
    const seen: Array<ReturnType<typeof summaryOf>> = [];
    manager.watchSummaries((envelope) => seen.push(summaryOf(envelope, sessionId)));
    manager.send(sessionId, "are you there?");
    // The clearing is told before the turn ends: the first summary after the message has no quiet.
    const first = seen.find((s) => s !== null);
    expect(first).toBeDefined();
    expect(first?.quietSince).toBeUndefined();
    expect(manager.list().find((s) => s.id === sessionId)?.quietSince).toBeUndefined();
  });

  test("clearing a session that was not quiet says nothing", async () => {
    const { manager, sessionId } = await idleSession();
    const seen: unknown[] = [];
    manager.watchSummaries((envelope) => seen.push(envelope));
    manager.markQuiet(sessionId, null);
    expect(seen).toEqual([]);
    // The same watcher does hear a real change.
    manager.markQuiet(sessionId, { since: "2026-11-09T12:05:00.000Z", tool: null });
    expect(seen).toHaveLength(1);
  });
});
