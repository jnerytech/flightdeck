import { describe, expect, test } from "bun:test";
import type { SessionRecap } from "@flightdeck/protocol";
import type { WebhookKind } from "../src/lib/webhook-format.ts";
import { type WebhookSource, Webhooks } from "../src/lib/webhooks.ts";
import type { WebhookRequest } from "../src/platform/types.ts";

const RECAP: SessionRecap = {
  asked: "Fix the build",
  done: "Patched.",
  files: [],
  filesMore: 0,
  costUsd: null,
  question: null,
  state: "waiting",
  source: "transcript",
};

const source = (over: Partial<WebhookSource> = {}): WebhookSource => ({
  id: "e1",
  kind: "needs_you",
  hostId: "pi",
  hostName: "Pi",
  clientId: null,
  project: "github.com/acme/api",
  title: "Fix the build",
  detail: "Run it?",
  ...over,
});

function setup(options: { send?: boolean; summary?: "ok" | "fail" } = {}) {
  const store = new Map<string, string>();
  const vault = new Map<string, string>();
  const requests: WebhookRequest[] = [];
  const asked: Array<{ hostId: string; id: string; extra: unknown }> = [];
  let n = 0;
  const webhooks = new Webhooks({
    platform: {
      storage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      vault: {
        get: async (id: string) => vault.get(id) ?? null,
        set: async (id: string, v: string) => void vault.set(id, v),
        delete: async (id: string) => void vault.delete(id),
      } as never,
      ...(options.send === false
        ? {}
        : {
            webhookSend: async (request: WebhookRequest) => {
              requests.push(request);
              return { status: 200, retryAfterMs: null };
            },
          }),
    },
    summaryFor: async (hostId, id, extra) => {
      asked.push({ hostId, id, extra });
      if (options.summary === "fail") throw new Error("host offline");
      return RECAP;
    },
    now: () => 1_793_534_000_000,
    newId: () => `t${++n}`,
    sleep: async () => {},
    random: () => 0.5,
  });
  return { webhooks, requests, asked, vault };
}

const target = (name: string, over: object = {}) => ({
  name,
  type: "slack" as const,
  url: `https://hooks.slack.com/services/${name}`,
  hostScope: null,
  kinds: ["needs_you"] as WebhookKind[],
  clientId: null,
  ...over,
});

describe("webhook-eventos", () => {
  test("each of the five events reaches the targets that want it, once", async () => {
    const { webhooks, requests } = setup();
    await webhooks.targets.add(
      target("all", {
        kinds: ["needs_you", "session_ended", "session_failed", "budget_alert", "pr_watch"],
      }),
    );
    await webhooks.targets.add(target("budget-only", { kinds: ["budget_alert"] }));
    for (const kind of [
      "needs_you",
      "session_ended",
      "session_failed",
      "budget_alert",
      "pr_watch",
    ] as const) {
      await webhooks.emit(source({ id: kind, kind }));
    }
    await webhooks.idle();
    const urls = requests.map((r) => r.url.split("/").pop());
    expect(urls.filter((u) => u === "all")).toHaveLength(5);
    expect(urls.filter((u) => u === "budget-only")).toHaveLength(1);
  });

  test("an event with the same id is sent only once", async () => {
    const { webhooks, requests } = setup();
    await webhooks.targets.add(target("all"));
    await webhooks.emit(source());
    await webhooks.emit(source());
    await webhooks.idle();
    expect(requests).toHaveLength(1);
    await webhooks.emit(source({ id: "e2" }));
    await webhooks.idle();
    expect(requests).toHaveLength(2);
  });

  test("a host-scoped target ignores the events of other hosts and a client target the other clients", async () => {
    const { webhooks, requests } = setup();
    await webhooks.targets.add(target("pi-only", { hostScope: "pi" }));
    await webhooks.targets.add(target("acme", { clientId: "acme" }));
    await webhooks.emit(source({ id: "a", hostId: "laptop" }));
    await webhooks.idle();
    expect(requests).toHaveLength(0);
    await webhooks.emit(source({ id: "b", hostId: "pi", clientId: "acme" }));
    await webhooks.idle();
    expect(requests.map((r) => r.url.split("/").pop()).sort()).toEqual(["acme", "pi-only"]);
  });

  test("the summary of the session is asked of its host and put in the message", async () => {
    const { webhooks, requests, asked } = setup();
    await webhooks.targets.add(target("all"));
    await webhooks.emit(source({ claudeSessionId: "c-1" }));
    await webhooks.idle();
    expect(asked).toEqual([{ hostId: "pi", id: "c-1", extra: { question: "Run it?" } }]);
    expect(requests[0]?.body).toContain("Patched.");
  });

  test("a summary that cannot be had does not stop the message", async () => {
    const { webhooks, requests } = setup({ summary: "fail" });
    await webhooks.targets.add(target("all"));
    await webhooks.emit(source({ claudeSessionId: "c-1" }));
    await webhooks.idle();
    expect(requests).toHaveLength(1);
  });

  test("with no target that wants the event nothing is asked or sent", async () => {
    const { webhooks, requests, asked } = setup();
    await webhooks.targets.add(target("budget", { kinds: ["budget_alert"] }));
    await webhooks.emit(source({ claudeSessionId: "c-1" }));
    await webhooks.idle();
    expect(requests).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  test("the URL comes from the vault, the generic message is signed, and a disabled target is skipped", async () => {
    const { webhooks, requests } = setup();
    await webhooks.targets.add(
      target("gen", { type: "generic", url: "https://example.com/in?k=1", signingSecret: "sig" }),
    );
    const off = await webhooks.targets.add(target("off"));
    await webhooks.targets.update(off.id, { enabled: false });
    await webhooks.emit(source());
    await webhooks.idle();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://example.com/in?k=1");
    expect(requests[0]?.headers["X-Flightdeck-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test("a build that cannot send does nothing and says it is not supported", async () => {
    const { webhooks, requests } = setup({ send: false });
    expect(webhooks.supported()).toBe(false);
    await webhooks.targets.add(target("all"));
    await webhooks.emit(source());
    await webhooks.idle();
    expect(requests).toHaveLength(0);
  });

  test("the result of a send is kept on the target", async () => {
    const { webhooks } = setup();
    const t = await webhooks.targets.add(target("all"));
    await webhooks.emit(source());
    await webhooks.idle();
    expect(webhooks.targets.list().find((x) => x.id === t.id)).toMatchObject({
      status: "ok",
      lastHttpStatus: 200,
    });
  });
});
