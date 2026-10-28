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
