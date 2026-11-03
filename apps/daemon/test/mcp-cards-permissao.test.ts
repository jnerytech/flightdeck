import { describe, expect, test } from "bun:test";
import type { PermissionUpdate, SessionEvent } from "@flightdeck/protocol";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { RiskClassifier } from "../src/permissions/risk.ts";
import { EventStore } from "../src/store/event-store.ts";
import { tempDir } from "./helpers.ts";

const TOOL = "mcp__flightdeck__finish_card";
const risk = new RiskClassifier({ allowedRoots: [], home: tempDir() });
const always: PermissionUpdate = {
  type: "addRules",
  behavior: "allow",
  destination: "localSettings",
  rules: [{ toolName: TOOL }],
};

function broker() {
  const store = new EventStore(":memory:");
  store.createSession({
    id: "s",
    name: null,
    cwd: "/",
    status: "running",
    permissionMode: "default",
    model: null,
  });
  const events: SessionEvent[] = [];
  const b = new PermissionBroker(store, {
    emit: (_id, event) => events.push(event),
    onPendingChange: () => {},
    classify: (_s, tool, input) => risk.classify(tool, input as Record<string, unknown>, "/"),
  });
  return { b, events };
}

describe("mcp-cards-permissao: discarding a card is always a question", () => {
  test("finish_card with discard is high risk, so no rule or AI approves it; done is the usual MCP risk", () => {
    expect(risk.classify(TOOL, { outcome: "discard" }, "/").level).toBe("high");
    expect(risk.classify(TOOL, { outcome: "done" }, "/").level).toBe("medium");
    expect(risk.classify("mcp__flightdeck__move_card", { column: "done" }, "/").level).toBe(
      "medium",
    );
  });

  test("the request does not offer 'always allow' for it, and a rule for it is refused", async () => {
    const { b, events } = broker();
    const pending = b.request("s", TOOL, { outcome: "discard" }, new AbortController().signal, [
      always,
    ]);
    const requested = events.find((e) => e.type === "permission.requested");
    expect(
      requested && "suggestions" in requested ? requested.suggestions : undefined,
    ).toBeUndefined();
    const requestId = (requested as { requestId: string }).requestId;
    expect(() => b.respond({ requestId, decision: "allow", updatedPermissions: [always] })).toThrow(
      /sempre pergunta/,
    );
    b.respond({ requestId, decision: "allow" });
    expect(await pending).toEqual({ behavior: "allow" });
  });

  test("other tools keep their suggestions", () => {
    const { b, events } = broker();
    const suggestion: PermissionUpdate = { ...always, rules: [{ toolName: "Bash" }] };
    void b.request("s", "Bash", {}, new AbortController().signal, [suggestion]);
    const requested = events.find((e) => e.type === "permission.requested");
    expect(requested && "suggestions" in requested ? requested.suggestions : undefined).toEqual([
      suggestion,
    ]);
  });
});
