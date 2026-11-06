import { describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { emptySession } from "../src/lib/session-state.ts";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

/**
 * A store whose session shows a high-risk request the host's summary does not list yet (a tile
 * draws it from the session's own events), with what reaches the host recorded.
 */
function storeWithUnlistedHighRisk() {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const sent: string[] = [];
  const hidden = store as unknown as {
    state: unknown;
    connections: Map<string, { request(type: string, payload: unknown): Promise<unknown> }>;
  };
  hidden.state = {
    ...store.getState(),
    hosts: [{ id: "h1", name: "alfa", sessions: [] }],
    sessions: {
      "h1/s1": {
        ...emptySession(),
        pending: ["r1"],
        items: [
          {
            kind: "permission",
            seq: 1,
            requestId: "r1",
            toolName: "Bash",
            input: { command: "rm -rf build" },
            risk: "high",
          },
        ],
      },
    },
  };
  hidden.connections.set("h1", {
    request: async (type, payload) => {
      sent.push(`${type}:${(payload as { decision?: string }).decision ?? ""}`);
    },
  });
  return { store, sent };
}

// Issue #245 (M2): the risk is looked up where the request is drawn, not only in the queue.
describe("hold-proof: the store checks the hold of a request it knows from the session", () => {
  test("a high-risk request not yet in the queue is still refused without the hold", async () => {
    const { store, sent } = storeWithUnlistedHighRisk();
    await store.respondTo("h1", "r1", "allow");
    expect(sent).toEqual([]);
    expect(store.getState().notices.at(-1)?.text).toBe(
      "A high-risk request is approved only by holding the button.",
    );
    await store.respondTo("h1", "r1", "allow", { held: true });
    expect(sent).toEqual(["permission.respond:allow"]);
  });
});
