import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command, type EventEnvelope, SessionEvent } from "@flightdeck/protocol";
import {
  applyEnvelope,
  emptySession,
} from "../../../desktop/src/features/sessions/domain/session-state.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { SummaryService } from "../../src/summary/service.ts";
import { newManager, poll, reasonOf, tempDir } from "../support/helpers.ts";
import { summaries } from "../support/summaries.ts";

describe("resumos", () => {
  test("schema: sessions.watch e session.summary", () => {
    expect(Command.safeParse({ id: "1", type: "sessions.watch", payload: {} }).success).toBe(true);
    const summary = {
      type: "session.summary",
      sessionId: "s",
      name: null,
      cwd: "/p",
      status: "awaiting_permission",
      pendingPermissions: [
        { requestId: "r", toolName: "Bash", createdAt: "2026-10-28T00:00:00.000Z" },
      ],
      updatedAt: "2026-10-28T00:00:00.000Z",
    };
    expect(SessionEvent.safeParse(summary).success).toBe(true);
    expect(SessionEvent.safeParse({ ...summary, status: "x" }).success).toBe(false);
  });

  test("watch recebe o estado atual e um resumo a cada mudança de estado e de pendências", async () => {
    const { manager, project } = newManager();
    const existing = await manager.create({ cwd: project, prompt: "antes" });
    await poll(() => manager.get(existing.sessionId).status === "idle");

    const received: EventEnvelope[] = [];
    const watch = manager.watchSummaries((e) => received.push(e));
    expect(summaries(watch.snapshot).map((s) => [s.sessionId, s.status])).toEqual([
      [existing.sessionId, "idle"],
    ]);

    const { sessionId } = await manager.create({ cwd: project, prompt: "[tool]", name: "n" });
    const waiting = await poll(() =>
      summaries(received).find(
        (s) => s.sessionId === sessionId && s.pendingPermissions.length === 1,
      ),
    );
    expect(waiting?.status).toBe("awaiting_permission");
    expect(waiting?.name).toBe("n");
    expect(waiting?.pendingPermissions[0]?.toolName).toBe("Write");
    expect(Date.parse(waiting?.pendingPermissions[0]?.createdAt ?? "")).not.toBeNaN();

    manager.respondPermission({
      requestId: waiting?.pendingPermissions[0]?.requestId ?? "",
      decision: "allow",
    });
    await poll(() => manager.get(sessionId).status === "idle");
    const statuses = summaries(received)
      .filter((s) => s.sessionId === sessionId)
      .map((s) => `${s.status}:${s.pendingPermissions.length}`);
    expect(statuses).toEqual([
      "starting:0",
      "running:0",
      "awaiting_permission:1",
      "running:0",
      "idle:0",
    ]);

    watch.unwatch();
    const before = received.length;
    await manager.close(sessionId);
    expect(received).toHaveLength(before);
  });

  test("watcher com erro não quebra a sessão", async () => {
    const { manager, project } = newManager();
    let calls = 0;
    manager.watchSummaries(() => {
      calls++;
      throw new Error("watcher quebrado");
    });
    const { sessionId } = await manager.create({ cwd: project, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle");
    expect(manager.get(sessionId).status).toBe("idle");
    expect(calls).toBeGreaterThan(0);
  });

  test("o reducer de sessão do app ignora session.summary: a barra lateral é que usa os resumos", () => {
    const state = { ...emptySession(), lastSeq: 3 };
    const next = applyEnvelope(state, {
      type: "event",
      sessionId: "s",
      seq: 4,
      ts: "2026-10-28T00:00:00.000Z",
      event: {
        type: "session.summary",
        sessionId: "s",
        name: null,
        cwd: "/p",
        status: "idle",
        pendingPermissions: [],
        updatedAt: "2026-10-28T00:00:00.000Z",
      },
    });
    expect(next).toBe(state);
  });

  test("dois pedidos simultâneos geram resumos com 1 e 2 pendências", async () => {
    const { manager, project } = newManager({
      runtime: {
        start: (opts) => ({
          events: (async function* () {
            yield { type: "session.init" as const, claudeSessionId: "c", model: "m", tools: [] };
            await new Promise(() => {});
          })(),
          send: () => {
            for (const tool of ["Bash", "Write"]) {
              void opts.canUseTool(tool, {}, { signal: new AbortController().signal });
            }
          },
          interrupt: async () => {},
          close: async () => {},
        }),
      },
    });
    const received: EventEnvelope[] = [];
    manager.watchSummaries((e) => received.push(e));
    const { sessionId } = await manager.create({ cwd: project, prompt: "duas" });
    const flat = () =>
      summaries(received)
        .filter((s) => s.sessionId === sessionId)
        .map((s) => `${s.status}:${s.pendingPermissions.map((p) => p.toolName).join(",")}`);
    await poll(() => flat().length >= 3, 1000);
    expect(flat()).toEqual([
      // The requests arrive on send, before init is consumed: starting goes straight to waiting.
      "starting:",
      "awaiting_permission:Bash",
      "awaiting_permission:Bash,Write",
    ]);
  });

  test("three simultaneous requests are listed one more at a time, each only once announced", async () => {
    const { manager, project } = newManager({
      runtime: {
        start: (opts) => ({
          events: (async function* () {
            yield { type: "session.init" as const, claudeSessionId: "c", model: "m", tools: [] };
            await new Promise(() => {});
          })(),
          send: () => {
            for (const tool of ["Bash", "Write", "Read"]) {
              void opts.canUseTool(tool, {}, { signal: new AbortController().signal });
            }
          },
          interrupt: async () => {},
          close: async () => {},
        }),
      },
    });
    const received: EventEnvelope[] = [];
    manager.watchSummaries((e) => received.push(e));
    const { sessionId } = await manager.create({ cwd: project, prompt: "tres" });
    const counts = () =>
      summaries(received)
        .filter((s) => s.sessionId === sessionId)
        .map((s) => s.pendingPermissions.length);
    await poll(() => counts().length >= 4, 1000);
    expect(counts()).toEqual([0, 1, 2, 3]);
  });
});

describe("resumos: a transcript that is gone", () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  test("the summary of a session whose transcript file is gone is 'not indexed'", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    store.db
      .query("INSERT INTO history_sessions (claude_session_id, file_path) VALUES (?, ?)")
      .run("gone", join(tempDir(), "no-such-transcript.jsonl"));
    const service = new SummaryService({ db: store.db, scanner: new SecretScanner() });
    expect(await reasonOf(service.get("gone"))).toBe("transcript_not_indexed");
  });
});
