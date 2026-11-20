import { describe, expect, test } from "bun:test";
import { seedDemoHosts } from "../../src/demo/boot.ts";
import { emptySession } from "../../src/features/sessions/domain/session-state.ts";
import { memoryPlatform } from "../fixtures.ts";

const { AppStore } = await import("../../src/lib/app-store.ts");
const { routeFrame } = await import("../../src/features/hosts/frame-router.ts");

/**
 * A store on a host that checks the proof, with a high-risk request in its session, a device that holds
 * a key and a system dialog that says `answer`; what reaches the host is recorded (#3439).
 */
function store(answer: "yes" | "no") {
  const mem = memoryPlatform(false, "en");
  seedDemoHosts(mem.win.localStorage, mem.tokens, [
    { id: "h1", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
  ]);
  const platform = {
    ...mem.platform,
    approvalKeys: {
      get: async () => ({ publicKey: "pub", keyId: "k1" }),
      create: async () => ({ publicKey: "pub", keyId: "k1" }),
      delete: async () => {},
      sign: async () => {
        if (answer === "no") throw new Error("declined");
        return "sig";
      },
    },
  };
  const app = new AppStore(platform, { baseDelayMs: 600_000 });
  app.i18n.start();
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const hidden = app as unknown as {
    state: unknown;
    link: {
      connections: Map<string, { request(type: string, payload: unknown): Promise<unknown> }>;
    };
  };
  hidden.state = {
    ...app.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        sessions: [],
        hostInfo: { features: ["approval-proof", "approval-watch"], daemonId: "d1" },
      },
    ],
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
  hidden.link.connections.set("h1", {
    request: async (type, payload) => {
      sent.push({ type, payload: payload as Record<string, unknown> });
      if (type === "approval.list") {
        return {
          daemonId: "d1",
          protectionOff: false,
          keys: [{ keyId: "k1", name: "n", client: "c", address: "a", enrolledAt: "t" }],
        };
      }
      if (type === "approval.challenge")
        return { nonce: "n1", daemonId: "d1", expiresInMs: 60_000 };
      return undefined;
    },
  });
  return { app, sent };
}

describe("approval-wiring: the store signs a high-risk allow with this device's key (#3439)", () => {
  test("the host announces the proof and a key is held, so the device can enroll and prove", () => {
    expect(store("yes").app.approval.supported("h1")).toBe(true);
  });

  test("a held allow is sent with the proof the device signed after the dialog", async () => {
    const { app, sent } = store("yes");
    await app.respondTo("h1", "r1", "allow", { held: true });
    const respond = sent.find((s) => s.type === "permission.respond");
    expect(respond?.payload).toEqual({
      requestId: "r1",
      decision: "allow",
      held: true,
      proof: { keyId: "k1", nonce: "n1", signature: "sig" },
    });
  });

  test("when the person declines the dialog nothing is sent and no notice is raised", async () => {
    const { app, sent } = store("no");
    const notices = app.getState().notices.length;
    await app.respondTo("h1", "r1", "allow", { held: true });
    expect(sent.some((s) => s.type === "permission.respond")).toBe(false);
    expect(app.getState().notices.length).toBe(notices);
  });
});

const FOREIGN = {
  type: "approval.enrolled",
  keyId: "k9",
  name: "Unknown tablet",
  client: "c",
  address: "a",
  enrolledAt: "t",
} as const;

/** The store's link handlers, which a connection calls for each frame and each time its host comes online. */
function handlersOf(app: unknown) {
  return (
    app as {
      handlers: {
        routes: { onApproval?: (host: { id: string }, change: unknown) => void };
        onlineSteps: Array<{
          gate?: string;
          run: (ctx: {
            hostId: string;
            conn: unknown;
            hostInfo: null;
            connect: boolean;
          }) => unknown;
        }>;
      };
    }
  ).handlers;
}

describe("approval-wiring: a device enrolled or revoked on a host reaches the person (#3477)", () => {
  test("the connection hands the host's announcement to the callback that takes it", () => {
    const heard: unknown[] = [];
    const handled = routeFrame({ onApproval: (change: unknown) => heard.push(change) } as never, {
      ...FOREIGN,
    });
    expect(handled).toBe(true);
    expect(heard).toEqual([FOREIGN]);
  });

  test("a device nobody here made raises an alert that names the device and the host", async () => {
    const { app } = store("yes");
    handlersOf(app).routes.onApproval?.({ id: "h1" }, FOREIGN);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const notice = app.getState().notices.find((n) => n.text.includes("Unknown tablet"));
    expect(notice?.kind).toBe("error");
    expect(notice?.text).toContain("alfa");
  });

  test("a host that announces approval-watch is asked to watch each time it comes online", async () => {
    const { app } = store("yes");
    const step = handlersOf(app).onlineSteps.find((s) => s.gate === "approval-watch");
    const asked: string[] = [];
    await step?.run({
      hostId: "h1",
      conn: { request: async (type: string) => asked.push(type) },
      hostInfo: null,
      connect: true,
    });
    expect(asked).toEqual(["approval.watch"]);
  });
});
