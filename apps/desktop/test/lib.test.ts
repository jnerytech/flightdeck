import { describe, expect, test } from "bun:test";
import type { EventEnvelope, PendingPermission, SessionEvent } from "@flightdeck/protocol";
import { backoffDelay } from "../src/lib/backoff.ts";
import { toolDiff } from "../src/lib/diff.ts";
import { summaryNotifications } from "../src/lib/notify.ts";
import { applyEnvelope, emptySession, endStreaming } from "../src/lib/session-state.ts";
import { statusTone } from "../src/lib/status.ts";

const env = (seq: number, event: SessionEvent): EventEnvelope => ({
  type: "event",
  sessionId: "s",
  seq,
  ts: "2026-10-28T00:00:00.000Z",
  event,
});

describe("desktop: backoff", () => {
  test("cresce exponencialmente de 1 s até 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map((n) => backoffDelay(n))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffDelay(2, 10, 100)).toBe(40);
  });
});

describe("desktop: estado da sessão", () => {
  test("monta a conversa, junta deltas e descarta duplicados", () => {
    let s = emptySession();
    s = applyEnvelope(
      s,
      env(1, { type: "session.created", cwd: "/p", name: null, permissionMode: "default" }),
    );
    s = applyEnvelope(s, env(2, { type: "session.status", status: "running" }));
    s = applyEnvelope(s, env(3, { type: "message.user", text: "oi" }));
    s = applyEnvelope(s, env(3, { type: "message.delta", text: "Ol" }));
    s = applyEnvelope(s, env(3, { type: "message.delta", text: "á" }));
    expect(s.streaming).toBe("Olá");
    expect(s.lastSeq).toBe(3);
    s = applyEnvelope(
      s,
      env(4, { type: "message.assistant", blocks: [{ type: "text", text: "Olá" }] }),
    );
    expect(s.streaming).toBe("");
    s = applyEnvelope(
      s,
      env(4, { type: "message.assistant", blocks: [{ type: "text", text: "dup" }] }),
    );
    s = applyEnvelope(
      s,
      env(5, {
        type: "turn.result",
        subtype: "success",
        isError: false,
        durationMs: 5,
        costUsd: 0.1,
      }),
    );
    s = applyEnvelope(s, env(6, { type: "session.status", status: "idle" }));
    expect(s.status).toBe("idle");
    expect(s.cwd).toBe("/p");
    expect(s.items.map((i) => i.kind)).toEqual(["user", "assistant", "result"]);
    expect(s.lastSeq).toBe(6);
  });

  test("applying and leaving a persona are marked on the session's timeline", () => {
    let s = emptySession();
    const persona = { id: "seg", name: "Segurança", icon: null };
    s = applyEnvelope(s, env(1, { type: "persona.applied", persona }));
    s = applyEnvelope(s, env(2, { type: "persona.cleared", persona }));
    expect(s.items).toEqual([
      { kind: "persona", seq: 1, applied: true, name: "Segurança" },
      { kind: "persona", seq: 2, applied: false, name: "Segurança" },
    ]);
    expect(s.lastSeq).toBe(2);
  });

  test("pedido de permissão vira card, é resolvido e o resultado da ferramenta é indexado", () => {
    let s = emptySession();
    s = applyEnvelope(
      s,
      env(1, { type: "session.init", claudeSessionId: "c", model: "opus", tools: [] }),
    );
    s = applyEnvelope(
      s,
      env(2, {
        type: "message.assistant",
        blocks: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "a" } }],
      }),
    );
    s = applyEnvelope(
      s,
      env(3, { type: "permission.requested", requestId: "r1", toolName: "Write", input: {} }),
    );
    expect(s.pending).toEqual(["r1"]);
    s = applyEnvelope(
      s,
      env(4, { type: "permission.resolved", requestId: "r1", decision: "deny", message: "não" }),
    );
    s = applyEnvelope(
      s,
      env(5, { type: "permission.resolved", requestId: "outro", decision: "expired" }),
    );
    s = applyEnvelope(
      s,
      env(6, { type: "tool.result", toolUseId: "t1", content: "não", isError: true }),
    );
    s = applyEnvelope(s, env(7, { type: "session.error", code: "runtime", message: "boom" }));
    s = applyEnvelope(s, env(8, { type: "session.status", status: "error", reason: "boom" }));
    expect(s.model).toBe("opus");
    expect(s.pending).toEqual([]);
    const card = s.items.find((i) => i.kind === "permission");
    expect(card).toMatchObject({ resolution: { decision: "deny", message: "não" } });
    expect(s.toolResults.t1).toEqual({ content: "não", isError: true });
    expect(s.items.at(-1)).toMatchObject({ kind: "error", message: "boom" });
    expect(s.statusReason).toBe("boom");
  });

  test("session.summary não altera a conversa nem o lastSeq", () => {
    const before = applyEnvelope(emptySession(), env(1, { type: "message.user", text: "oi" }));
    const after = applyEnvelope(
      before,
      env(5, {
        type: "session.summary",
        sessionId: "s",
        name: null,
        cwd: "/p",
        status: "idle",
        pendingPermissions: [],
        updatedAt: "2026-10-28T00:00:00.000Z",
      } as SessionEvent),
    );
    expect(after).toEqual(before);
  });

  test("endStreaming limpa o texto parcial (usado ao reconectar)", () => {
    const s = applyEnvelope(emptySession(), env(0, { type: "message.delta", text: "x" }));
    expect(endStreaming(s).streaming).toBe("");
  });
});

describe("desktop: diff de edição", () => {
  test("Edit mostra linhas removidas e adicionadas", () => {
    expect(
      toolDiff("Edit", { file_path: "a", old_string: "um\ndois\n", new_string: "um\nDOIS\n" }),
    ).toEqual([
      { op: " ", text: "um" },
      { op: "-", text: "dois" },
      { op: "+", text: "DOIS" },
    ]);
  });

  test("Write mostra o conteúdo como adição e MultiEdit concatena as edições", () => {
    expect(toolDiff("Write", { file_path: "a", content: "x\ny" })).toEqual([
      { op: "+", text: "x" },
      { op: "+", text: "y" },
    ]);
    expect(
      toolDiff("MultiEdit", {
        edits: [
          { old_string: "a", new_string: "b" },
          { old_string: "c", new_string: "c" },
        ],
      }),
    ).toEqual([
      { op: "-", text: "a" },
      { op: "+", text: "b" },
      { op: " ", text: "c" },
    ]);
  });

  test("outras ferramentas ou input inesperado não têm diff", () => {
    expect(toolDiff("Bash", { command: "ls" })).toBeNull();
    expect(toolDiff("Edit", { file_path: "a" })).toBeNull();
    expect(toolDiff("Write", {})).toBeNull();
    expect(toolDiff("MultiEdit", { edits: "x" })).toBeNull();
    expect(toolDiff("MultiEdit", { edits: [null, { old_string: 1 }] })).toEqual([]);
  });
});

describe("desktop: notificações e status", () => {
  test("notifica pedido novo e fim de turno comparando resumos, só fora de foco", () => {
    const base = { status: "running" as const, pendingPermissions: [] as PendingPermission[] };
    const asking = {
      status: "awaiting_permission" as const,
      pendingPermissions: [{ requestId: "r1", toolName: "Bash", createdAt: "t" }],
    };
    expect(summaryNotifications(undefined, asking, "pc · s", false)).toEqual([]);
    expect(summaryNotifications(base, asking, "pc · s", false)).toEqual([
      { title: "pc · s: esperando você", body: "Permitir Bash?" },
    ]);
    expect(summaryNotifications(asking, asking, "pc · s", false)).toEqual([]);
    expect(summaryNotifications(base, { ...base, status: "idle" }, "pc · s", false)).toEqual([
      { title: "pc · s: turno concluído", body: "ociosa" },
    ]);
    expect(
      summaryNotifications({ ...base, status: "idle" }, { ...base, status: "idle" }, "x", false),
    ).toEqual([]);
    expect(summaryNotifications(base, asking, "pc · s", true)).toEqual([]);
  });

  test("rótulos e tons de status", () => {
    expect(statusTone("awaiting_permission")).toBe("needs-you");
    expect(statusTone("running")).toBe("running");
    expect(statusTone("starting")).toBe("running");
    expect(statusTone("error")).toBe("error");
    expect(statusTone("idle")).toBe("idle");
    expect(statusTone("ended")).toBe("ended");
  });
});
