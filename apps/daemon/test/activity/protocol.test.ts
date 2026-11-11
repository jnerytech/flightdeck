import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as protocol from "@flightdeck/protocol";
import { type RunningServer, startServer } from "../../src/server.ts";
import { newManager, poll } from "../helpers.ts";

setDefaultTimeout(30_000);

/** Issue #1344: `activity.since` over the socket: capped, announced by host.info, off when not wired. */
const TOKEN = "activity-protocol-token-0123456789";
const stops: Array<() => unknown> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 10_000);
  ws.close();
  return ack;
}

const EMPTY = { items: [], total: 0 };
const SINCE = "2026-11-08T22:00:00.000Z";

function host(withActivity: boolean) {
  const calls: Array<[string, number]> = [];
  const server = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
    ...(withActivity
      ? {
          activity: (since: string, limit: number): protocol.ActivitySinceResult => {
            calls.push([since, limit]);
            return {
              since,
              sessions: EMPTY,
              reviewCards: EMPTY,
              prs: EMPTY,
              failedRuns: EMPTY,
              quota: [],
            };
          },
        }
      : {}),
  });
  stops.push(() => server.stop());
  return { server, calls };
}

describe("activity-protocolo (#1344)", () => {
  test("the payload takes an ISO time and a limit of 1 to 50, and nothing else", () => {
    const parse = (payload: object) =>
      protocol.Command.safeParse({ id: "1", type: "activity.since", payload }).success;
    expect([
      parse({ since: SINCE }),
      parse({ since: SINCE, limit: 50 }),
      parse({ since: SINCE, limit: 51 }),
      parse({ since: SINCE, limit: 0 }),
      parse({ since: "last night" }),
      parse({ limit: 5 }),
      parse({ since: SINCE, extra: 1 }),
    ]).toEqual([true, true, false, false, false, false, false]);
  });

  test("activity.since answers with the digest at the default limit, and host.info announces it", async () => {
    const h = host(true);
    const ack = await ask(h.server, "activity.since", { since: SINCE });
    const ranged = await ask(h.server, "activity.since", { since: SINCE, limit: 5 });
    const info = await ask(h.server, "host.info", {});
    expect([
      ack?.ok && (ack.data as protocol.ActivitySinceResult).since,
      ranged?.ok,
      h.calls,
      info?.ok && (info.data as { features: string[] }).features.includes("activity"),
    ]).toEqual([
      SINCE,
      true,
      [
        [SINCE, 20],
        [SINCE, 5],
      ],
      true,
    ]);
  });

  test("a time without milliseconds is read as the same instant the store compares with", async () => {
    const h = host(true);
    await ask(h.server, "activity.since", { since: "2026-11-08T22:00:00Z" });
    expect(h.calls).toEqual([[SINCE, 20]]);
  });

  test("a host without it refuses with feature_off and does not announce it", async () => {
    const h = host(false);
    const refused = await ask(h.server, "activity.since", { since: SINCE });
    const info = await ask(h.server, "host.info", {});
    expect([
      refused && !refused.ok && refused.error.reason,
      info?.ok && (info.data as { features: string[] }).features.includes("activity"),
    ]).toEqual(["feature_off", false]);
  });
});
