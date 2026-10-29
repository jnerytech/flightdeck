import { describe, expect, test } from "bun:test";
import {
  Command,
  type CommandType,
  EventEnvelope,
  ServerMessage,
  SessionEvent,
} from "../src/index.ts";

const validCommands: Record<CommandType, unknown> = {
  hello: { token: "t".repeat(20), client: "test" },
  "session.list": {},
  "session.create": {
    cwd: "/tmp/x",
    prompt: "oi",
    name: "n",
    permissionMode: "default",
    model: "m",
  },
  "session.send": { sessionId: "s", text: "oi" },
  "session.interrupt": { sessionId: "s" },
  "session.close": { sessionId: "s" },
  "session.resume": { sessionId: "s" },
  "session.subscribe": { sessionId: "s", sinceSeq: 3 },
  "session.unsubscribe": { sessionId: "s" },
  "permission.respond": { requestId: "r", decision: "allow", updatedInput: { a: 1 } },
  "sessions.watch": {},
  "host.info": {},
  "history.list": {
    cwd: "/p",
    from: "2026-09-01",
    to: "2026-09-30",
    origin: "external",
    limit: 10,
  },
  "history.get": { claudeSessionId: "c", cursor: "20", limit: 50 },
  "history.search": { query: "flamingo", cwd: "/p", limit: 5 },
  "history.resume": { claudeSessionId: "c", name: "n", permissionMode: "default", force: true },
  "history.watch": {},
  "project.list": {},
  "project.add": {
    path: "/r",
    name: "r",
    baseBranch: "main",
    prProvider: "github",
    setupScript: "bun install",
    promptTemplate: "t",
  },
  "project.update": { projectId: "p", setupScript: null },
  "board.get": { projectId: "p" },
  "board.settings": { maxParallelRuns: 3 },
  "board.watch": {},
  "card.create": { projectId: "p", title: "t", description: "d" },
  "card.update": { cardId: "c", title: "t" },
  "card.move": { cardId: "c", column: "review", position: 1.5 },
  "card.start": { cardId: "c", workflow: "feature", inputs: { task: "somar" } },
  "card.get": { cardId: "c" },
  "card.stop": { cardId: "c" },
  "card.diff": { cardId: "c" },
  "card.message": { cardId: "c", text: "ajuste" },
  "card.pr.create": { cardId: "c" },
  "card.complete": { cardId: "c", confirm: true },
  "card.discard": { cardId: "c", confirm: true },
  "external.list": {},
  "external.watch": {},
  "external.message": { claudeSessionId: "c", text: "oi" },
  "session.meta.set": { claudeSessionId: "c", name: null, pinned: true, archived: false },
  "maintenance.status": {},
  "maintenance.backup": {},
  "maintenance.prune": { dryRun: true },
  "daemon.shutdown": {},
  "daemon.update.apply": { confirm: true },
  "hooks.status": {},
  "hooks.install": { confirm: true },
  "hooks.uninstall": { confirm: true },
  "workflow.list": { projectId: "p" },
  "workflow.validate": { projectId: "p", name: "feature" },
  "workflow.trust": { projectId: "p", name: "feature", hash: "abc" },
  "run.get": { runId: "r" },
  "run.watch": {},
  "gate.respond": { runId: "r", stepId: "approve", attempt: 1, decision: "reject", note: "não" },
  "quota.get": {},
  "quota.watch": {},
  "usage.summary": { days: 7 },
  "rules.list": { projectId: "p" },
  "rules.remove": { projectId: "p", rule: "Bash(npm test:*)", confirm: true },
  "costs.status": {},
  "costs.reprice": {},
  "costs.summary": { from: "2026-10-01", to: "2026-10-31", origin: "card" },
  "costs.session": { claudeSessionId: "c" },
  "costs.sessions": { claudeSessionIds: ["c"] },
  "costs.card": { cardId: "k" },
  "costs.run": { runId: "r" },
  "costs.export": { from: "2026-10-01", to: "2026-10-01", projectKey: "p" },
  "budget.list": {},
  "budget.set": {
    scope: "project",
    projectKey: "p",
    period: "month",
    limitUsd: 50,
    action: "queue",
  },
  "budget.remove": { id: "b" },
  "budget.watch": {},
  "quota.history": { window: "five_hour", hours: 24 },
  "changes.get": { target: "session:abc" },
  "changes.watch": { target: "card:k" },
  "changes.unwatch": { target: "card:k" },
  "review.list": { target: "card:k" },
  "review.add": {
    target: "card:k",
    path: "a.ts",
    side: "new",
    lineStart: 1,
    lineEnd: 2,
    body: "x",
  },
  "review.update": { id: "r", body: "y" },
  "review.remove": { id: "r" },
  "review.send": { target: "session:s" },
  "changes.revert": { target: "card:k", path: "a.ts", confirm: true },
  "changes.undoRevert": { target: "card:k", path: "a.ts", confirm: true },
  "file.read": { target: "session:s", path: "a.ts" },
  "file.write": { target: "session:s", path: "a.ts", text: "x", expectedHash: "h" },
};

const validEvents: SessionEvent[] = [
  { type: "session.created", cwd: "/x", name: null, permissionMode: "default" },
  { type: "session.status", status: "running" },
  { type: "session.status", status: "error", reason: "daemon reiniciado" },
  { type: "session.init", claudeSessionId: "c", model: "m", tools: ["Read"] },
  { type: "message.user", text: "oi" },
  {
    type: "message.assistant",
    blocks: [
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t1", name: "Write", input: { file_path: "a" } },
    ],
  },
  { type: "message.delta", text: "o" },
  { type: "tool.result", toolUseId: "t1", content: "ok", isError: false },
  { type: "permission.requested", requestId: "r", toolName: "Write", input: {} },
  { type: "permission.resolved", requestId: "r", decision: "expired" },
  {
    type: "turn.result",
    subtype: "success",
    isError: false,
    durationMs: 10,
    costUsd: 0,
    usage: { inputTokens: 1, outputTokens: 2 },
  },
  { type: "session.error", code: "runtime", message: "boom" },
];

describe("protocolo", () => {
  test.each(Object.entries(validCommands))("comando %s válido passa no schema", (type, payload) => {
    expect(Command.safeParse({ id: "1", type, payload }).success).toBe(true);
  });

  test.each(validEvents.map((e) => [e.type, e] as const))(
    "evento %s válido passa no schema",
    (_, event) => {
      expect(SessionEvent.safeParse(event).success).toBe(true);
      const envelope = {
        type: "event",
        sessionId: "s",
        seq: 1,
        ts: new Date().toISOString(),
        event,
      };
      expect(EventEnvelope.safeParse(envelope).success).toBe(true);
      expect(ServerMessage.safeParse(envelope).success).toBe(true);
    },
  );

  test("payload inválido é recusado pelo schema", () => {
    expect(
      Command.safeParse({ id: "1", type: "session.create", payload: { cwd: "" } }).success,
    ).toBe(false);
    expect(
      Command.safeParse({ id: "1", type: "session.send", payload: { sessionId: 1 } }).success,
    ).toBe(false);
    expect(Command.safeParse({ id: "1", type: "nope", payload: {} }).success).toBe(false);
    expect(Command.safeParse({ type: "session.list", payload: {} }).success).toBe(false);
    expect(
      Command.safeParse({
        id: "1",
        type: "permission.respond",
        payload: { requestId: "r", decision: "maybe" },
      }).success,
    ).toBe(false);
  });

  test("evento inválido é recusado pelo schema", () => {
    expect(SessionEvent.safeParse({ type: "session.status", status: "sleeping" }).success).toBe(
      false,
    );
    expect(SessionEvent.safeParse({ type: "unknown" }).success).toBe(false);
  });

  test("acks ok e erro passam no schema", () => {
    expect(
      ServerMessage.safeParse({ type: "ack", id: "1", ok: true, data: { x: 1 } }).success,
    ).toBe(true);
    expect(
      ServerMessage.safeParse({
        type: "ack",
        id: "1",
        ok: false,
        error: { code: "bad_request", message: "x" },
      }).success,
    ).toBe(true);
  });
});
