import { describe, expect, test } from "bun:test";
import { Webhooks } from "../src/lib/webhooks.ts";
import type { WebhookRequest, WebhookResponse } from "../src/platform/types.ts";

function setup(answers: Array<WebhookResponse | "throw">) {
  const store = new Map<string, string>();
  const vault = new Map<string, string>();
  const requests: WebhookRequest[] = [];
  const script = [...answers];
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
      webhookSend: async (request) => {
        requests.push(request);
        const next = script.shift() ?? { status: 200, retryAfterMs: null };
        if (next === "throw") throw new Error("boom");
        return next;
      },
    },
    now: () => 1_793_534_000_000,
    newId: () => `t${++n}`,
    sleep: async () => {},
    random: () => 0.5,
  });
  return { webhooks, requests };
}

const add = (webhooks: Webhooks, type: "slack" | "discord" | "generic" = "slack") =>
  webhooks.targets.add({
    name: "chan",
    type,
    url: "https://hooks.slack.com/services/SECRET",
    hostScope: null,
    kinds: ["needs_you"],
    clientId: null,
  });

describe("webhook-teste", () => {
  test("it sends a sample event once and answers with the status and the time", async () => {
    const { webhooks, requests } = setup([{ status: 200, retryAfterMs: null }]);
    const target = await add(webhooks);
    const result = await webhooks.test(target.id);
    expect(result).toEqual({ ok: true, httpStatus: 200, at: "2026-11-01T11:53:20.000Z" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://hooks.slack.com/services/SECRET");
    expect(requests[0]?.body).toContain("test");
  });

  test("the answer carries no body and no URL", async () => {
    const { webhooks } = setup([{ status: 404, retryAfterMs: null }]);
    const target = await add(webhooks);
    const result = await webhooks.test(target.id);
    expect(Object.keys(result).sort()).toEqual(["at", "httpStatus", "ok"]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  test("a failing answer or an error marks the target failing, with one try only", async () => {
    const { webhooks, requests } = setup([{ status: 500, retryAfterMs: null }, "throw"]);
    const target = await add(webhooks);
    expect(await webhooks.test(target.id)).toMatchObject({ ok: false, httpStatus: 500 });
    expect(webhooks.targets.list()[0]).toMatchObject({ status: "failing", lastHttpStatus: 500 });
    expect(await webhooks.test(target.id)).toMatchObject({ ok: false, httpStatus: null });
    expect(requests).toHaveLength(2);
  });

  test("a target that stopped on a permanent error recovers after a good test", async () => {
    const { webhooks, requests } = setup([
      { status: 404, retryAfterMs: null },
      { status: 200, retryAfterMs: null },
      { status: 200, retryAfterMs: null },
    ]);
    const target = await add(webhooks);
    const source = {
      id: "e1",
      kind: "needs_you" as const,
      hostId: "h",
      hostName: "H",
      clientId: null,
      project: null,
      title: "t",
      detail: null,
    };
    await webhooks.emit(source);
    await webhooks.idle();
    expect(webhooks.targets.list()[0]?.status).toBe("failing");
    await webhooks.emit({ ...source, id: "e2" });
    await webhooks.idle();
    expect(requests).toHaveLength(1);
    expect(await webhooks.test(target.id)).toMatchObject({ ok: true, httpStatus: 200 });
    expect(webhooks.targets.list()[0]?.status).toBe("ok");
    await webhooks.emit({ ...source, id: "e3" });
    await webhooks.idle();
    expect(requests).toHaveLength(3);
  });

  test("the sample uses the target's own format and the generic one is signed", async () => {
    const { webhooks, requests } = setup([]);
    const slack = await add(webhooks, "slack");
    const generic = await webhooks.targets.add({
      name: "g",
      type: "generic",
      url: "https://example.com/h",
      signingSecret: "k",
      hostScope: null,
      kinds: ["needs_you"],
      clientId: null,
    });
    await webhooks.test(slack.id);
    await webhooks.test(generic.id);
    expect(JSON.parse(requests[0]?.body ?? "{}").blocks).toBeDefined();
    expect(requests[1]?.headers["X-Flightdeck-Signature"]).toMatch(/^sha256=/);
  });

  test("an unknown target or one with no secret in the vault gives a failure and sends nothing", async () => {
    const { webhooks, requests } = setup([]);
    expect(await webhooks.test("nope")).toMatchObject({ ok: false, httpStatus: null });
    expect(requests).toHaveLength(0);
  });
});
