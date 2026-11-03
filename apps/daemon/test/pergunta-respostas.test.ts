import { describe, expect, test } from "bun:test";
import type { SessionEvent } from "@flightdeck/protocol";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { EventStore } from "../src/store/event-store.ts";

function setup() {
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
  const broker = new PermissionBroker(store, {
    emit: (_id, event) => events.push(event),
    onPendingChange: () => {},
    classify: () => ({ level: "medium", reason: "test", network: false }),
  });
  const requestId = () => {
    const open = events.find((e) => e.type === "permission.requested");
    return open?.type === "permission.requested" ? open.requestId : "";
  };
  const resolved = () => events.find((e) => e.type === "permission.resolved");
  return { broker, requestId, resolved };
}

describe("pergunta-respostas", () => {
  test("the resolved event of an AskUserQuestion carries the answers", () => {
    const { broker, requestId, resolved } = setup();
    void broker.request("s", "AskUserQuestion", { questions: [] }, new AbortController().signal);
    broker.respond({
      requestId: requestId(),
      decision: "allow",
      updatedInput: { questions: [], answers: { "Which database?": "Postgres" } },
    });
    expect(resolved()).toMatchObject({ answers: { "Which database?": "Postgres" } });
  });

  test("answers that are not strings are not carried", () => {
    const { broker, requestId, resolved } = setup();
    void broker.request("s", "AskUserQuestion", {}, new AbortController().signal);
    broker.respond({
      requestId: requestId(),
      decision: "allow",
      updatedInput: { answers: { q: 1 } },
    });
    expect(resolved()).not.toHaveProperty("answers");
  });

  test("another tool never carries answers", () => {
    const { broker, requestId, resolved } = setup();
    void broker.request("s", "Write", {}, new AbortController().signal);
    broker.respond({
      requestId: requestId(),
      decision: "allow",
      updatedInput: { answers: { q: "a" } },
    });
    expect(resolved()).not.toHaveProperty("answers");
  });
});
