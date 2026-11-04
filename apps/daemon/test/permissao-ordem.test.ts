import { describe, expect, test } from "bun:test";
import type { PlainInfo, SessionEvent } from "@flightdeck/protocol";
import { PermissionBroker } from "../src/permissions/permission-broker.ts";
import { EventStore } from "../src/store/event-store.ts";

const PLAIN = { sentence: { en: "x", "pt-BR": "x" } } as unknown as PlainInfo;

/** A broker whose automatic approval allows at once, with the given way of wording the request. */
function setup(plain?: () => Promise<PlainInfo>) {
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
    classify: () => ({ level: "low", reason: "test", network: false }),
    autoDecide: async () => ({ decision: "allow", by: "rule", reason: "safe" }) as never,
    ...(plain ? { plain } : {}),
  });
  const order = () => events.map((e) => e.type).filter((t) => t.startsWith("permission."));
  return { broker, order };
}

describe("permissao-ordem: the question is announced before any answer", () => {
  test("Given automatic approval and a slow plain wording, Then permission.requested comes before permission.resolved", async () => {
    const { broker, order } = setup(async () => {
      await Bun.sleep(30);
      return PLAIN;
    });
    const decision = await broker.request("s", "Write", {}, new AbortController().signal);
    expect(decision.behavior).toBe("allow");
    expect(order()).toEqual(["permission.requested", "permission.resolved"]);
  });

  test("Given automatic approval and a plain wording that fails, Then the order is the same", async () => {
    const { broker, order } = setup(() => Promise.reject(new Error("no files")));
    await broker.request("s", "Write", {}, new AbortController().signal);
    expect(order()).toEqual(["permission.requested", "permission.resolved"]);
  });

  test("Given automatic approval and no plain wording at all, Then the order is the same", async () => {
    const { broker, order } = setup();
    await broker.request("s", "Write", {}, new AbortController().signal);
    expect(order()).toEqual(["permission.requested", "permission.resolved"]);
  });
});
