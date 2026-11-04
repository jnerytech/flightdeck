import { describe, expect, test } from "bun:test";
import type { EventEnvelope, PlainInfo } from "@flightdeck/protocol";
import { applyEnvelope, emptySession } from "../src/lib/session-state.ts";

const plain: PlainInfo = {
  kind: "run",
  sentence: { en: "Run a step on this computer", "pt-BR": "Executar uma etapa neste computador" },
  consequence: {
    en: "It may change files on this computer.",
    "pt-BR": "Isso pode mudar arquivos neste computador.",
  },
  reversible: true,
  outcome: "ask",
  hold: false,
};

describe("task-plain: the plain wording reaches the conversation", () => {
  test("Given a permission request with its plain wording, When it is applied, Then the item keeps it", () => {
    const envelope = {
      type: "event",
      sessionId: "s",
      seq: 1,
      ts: "2026-11-03T10:00:00.000Z",
      event: {
        type: "permission.requested",
        requestId: "r1",
        toolName: "Bash",
        input: { command: "a && b" },
        plain,
      },
    } as EventEnvelope;
    const state = applyEnvelope(emptySession(), envelope);
    expect(state.items[0]).toMatchObject({ kind: "permission", requestId: "r1", plain });
  });
});
