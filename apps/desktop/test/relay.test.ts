import { describe, expect, test } from "bun:test";
import type { MessageInfo, RelayMessage } from "@flightdeck/protocol";
import { type RelayHost, relayMessage, relayUpdate, syncPeers } from "../src/lib/relay.ts";

const MESSAGE: RelayMessage = {
  id: "m1",
  from: { id: "s1", host: "host-a", name: "a1", persona: null, projectKey: "k", teamId: null },
  toSession: "s2",
  toHost: "host-b",
  text: "oi",
  createdAt: "2026-10-30T12:00:00.000Z",
  untrusted: false,
  kind: "session",
};

/** Two hosts (and a third that is offline), each answering by a table; every call recorded. */
function setup(answers: Record<string, unknown> = {}, hosts?: RelayHost[]) {
  const calls: Array<[string, string, unknown]> = [];
  const deps = {
    hosts: () =>
      hosts ?? [
        { id: "A", hostName: "host-a", online: true },
        { id: "B", hostName: "host-b", online: true },
        { id: "C", hostName: "host-c", online: false },
      ],
    call: async (hostId: string, type: string, payload: unknown) => {
      calls.push([hostId, type, payload]);
      const answer = answers[`${hostId} ${type}`];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { deps, calls };
}

describe("relay: the app carries messages between the daemons of different hosts", () => {
  test("a message for another host goes to that daemon, and its result goes back to the origin", async () => {
    const { deps, calls } = setup({ "B messages.relay": { status: "queued", reason: null } });
    await relayMessage(deps, "A", MESSAGE);
    expect(calls).toEqual([
      ["B", "messages.relay", { message: MESSAGE }],
      ["A", "messages.relayed", { id: "m1", status: "queued", reason: null }],
    ]);
  });

  test("what the recipient's rules refuse goes back to the origin with the reason", async () => {
    const { deps, calls } = setup({
      "B messages.relay": { status: "refused", reason: "outro projeto" },
    });
    await relayMessage(deps, "A", MESSAGE);
    expect(calls.at(-1)).toEqual([
      "A",
      "messages.relayed",
      { id: "m1", status: "refused", reason: "outro projeto" },
    ]);
  });

  test("a host that is offline (no authenticated hello) or unknown gets nothing: the message waits in the origin's queue", async () => {
    const { deps, calls } = setup();
    await relayMessage(deps, "A", { ...MESSAGE, toHost: "host-c" });
    await relayMessage(deps, "A", { ...MESSAGE, toHost: "host-z" });
    expect(calls).toEqual([]);
  });

  test("when the target daemon fails, the origin is not told anything: the message stays queued for the next try", async () => {
    const { deps, calls } = setup({ "B messages.relay": new Error("caiu") });
    await relayMessage(deps, "A", MESSAGE);
    expect(calls.map(([h, t]) => `${h} ${t}`)).toEqual(["B messages.relay"]);
  });

  test("a relayed message delivered or refused at its recipient is told to its origin; one of this host, or still queued, is not", async () => {
    const { deps, calls } = setup();
    const info = (over: Partial<MessageInfo>): MessageInfo => ({
      id: "m1",
      fromSession: "s1",
      fromHost: "host-a",
      toSession: "s2",
      toHost: "host-b",
      text: "oi",
      status: "delivered",
      reason: null,
      createdAt: "2026-10-30T12:00:00.000Z",
      deliveredAt: "2026-10-30T12:00:01.000Z",
      teamId: null,
      kind: "session",
      ...over,
    });
    await relayUpdate(deps, "B", info({}));
    await relayUpdate(deps, "B", info({ id: "m2", status: "refused", reason: "laço" }));
    await relayUpdate(deps, "B", info({ id: "m3", status: "queued" }));
    await relayUpdate(deps, "B", info({ id: "m4", fromHost: "host-b" }));
    expect(calls).toEqual([
      ["A", "messages.relayed", { id: "m1", status: "delivered", reason: null }],
      ["A", "messages.relayed", { id: "m2", status: "refused", reason: "laço" }],
    ]);
  });

  test("each online daemon is told the sessions of every other online one", async () => {
    const { deps, calls } = setup({
      "A messages.directory": { host: "host-a", sessions: [{ id: "s1" }] },
      "B messages.directory": { host: "host-b", sessions: [{ id: "s2" }] },
    });
    await syncPeers(deps);
    const told = calls.filter(([, type]) => type === "messages.peers");
    expect(told).toEqual([
      ["B", "messages.peers", { host: "host-a", sessions: [{ id: "s1" }] }],
      ["A", "messages.peers", { host: "host-b", sessions: [{ id: "s2" }] }],
    ]);
    expect(calls.some(([host]) => host === "C")).toBe(false);
  });
});
