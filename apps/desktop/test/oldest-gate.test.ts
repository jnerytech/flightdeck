import { describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { memoryPlatform } from "./fixtures.ts";

const { AppStore } = await import("../src/lib/app-store.ts");

/**
 * A store whose oldest waiting item is an open gate of a workflow run, then a permission request,
 * with the answers and the opened requests recorded.
 */
function storeWithGateFirst() {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  const answered: Array<[string, string, string]> = [];
  const opened: string[] = [];
  const hidden = store as unknown as {
    state: unknown;
    respondTo(hostId: string, requestId: string, decision: string): Promise<void>;
  };
  hidden.state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        sessions: [
          {
            id: "s1",
            name: "Alpha",
            cwd: "/p",
            status: "idle",
            pendingPermissions: [
              { requestId: "r1", toolName: "Bash", createdAt: "2026-11-02T12:00:00Z" },
            ],
          },
        ],
      },
    ],
    cards: { "h1/c1": { id: "c1", projectId: "p", title: "Ship the cart" } },
    runs: {
      "h1/run1": {
        id: "run1",
        cardId: "c1",
        workflowName: "feature",
        steps: [
          {
            stepId: "review-plan",
            attempt: 1,
            type: "gate",
            status: "waiting",
            startedAt: "2026-11-02T10:00:00Z",
          },
        ],
      },
    },
  };
  hidden.respondTo = async (hostId, requestId, decision) => {
    answered.push([hostId, requestId, decision]);
  };
  store.onOpenRequest((item) => opened.push(item.requestId));
  return { store, answered, opened };
}

describe("oldest-gate: approve or deny the oldest request from the palette", () => {
  // OpenCode review R5b (#187): a gate is not a permission request. Answering it as one sent
  // permission.respond with "gate:run/step/attempt", which the host refuses, and the gate stayed.
  test("when the oldest is a workflow gate it is opened to be answered there, never sent as a permission", () => {
    const { store, answered, opened } = storeWithGateFirst();
    store.decideOldest("approve", "h1/gate:run1/review-plan/1");
    store.decideOldest("deny", "h1/gate:run1/review-plan/1");
    expect(answered).toEqual([]);
    expect(opened).toEqual(["gate:run1/review-plan/1", "gate:run1/review-plan/1"]);
  });

  test("a vault request first is opened to be seen, never granted from the palette", () => {
    const { store, answered, opened } = storeWithGateFirst();
    const hidden = store as unknown as {
      state: { vaultApprovals: unknown[]; runs: unknown };
      vaultQuestions: Map<string, (answer: unknown) => void>;
    };
    const granted: unknown[] = [];
    hidden.vaultQuestions.set("v1", (answer) => granted.push(answer));
    hidden.state = {
      ...hidden.state,
      runs: {},
      vaultApprovals: [
        {
          hostId: "h1",
          hostName: "alfa",
          sessionId: "s1",
          sessionName: "Alpha",
          requestId: "v1",
          toolName: "vault",
          createdAt: "2026-11-02T09:00:00Z",
          vault: true,
        },
      ],
    };
    store.decideOldest("approve", "h1/v1");
    expect([answered, granted, opened]).toEqual([[], [], ["v1"]]);
  });
});
