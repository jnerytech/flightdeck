import { afterEach, describe, expect, test } from "bun:test";
import { Command, WebhookSendResult } from "@flightdeck/protocol";
import { startServer } from "../src/server.ts";
import { WebhookSender } from "../src/webhook/sender.ts";
import { newManager } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "webhook-token-0123456789abcdef";
const URL_SECRET = "https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function served(withSender: boolean) {
  const logs: string[] = [];
  const posted: Array<{ url: string; body: string }> = [];
  const sender = new WebhookSender({
    resolve: async () => ["93.184.216.34"],
    fetch: (async (url: string, init: RequestInit) => {
      posted.push({ url, body: String(init.body) });
      return new Response("body the app never sees", { status: 200 });
    }) as never,
    log: (m) => logs.push(m),
  });
  const { manager, root } = newManager();
  const server = startServer({
    manager,
    ...(withSender ? { webhook: sender } : {}),
    log: (m: string) => logs.push(m),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return { client, logs, posted };
}

const payload = {
  url: URL_SECRET,
  headers: { "Content-Type": "application/json" },
  body: '{"text":"hi"}',
};

describe("webhook-protocolo", () => {
  test("the host announces webhook and webhook.send answers with the status only", async () => {
    const { client, posted } = await served(true);
    expect(
      (await client.data<{ features: string[] }>("host.info", {}))?.features.filter(
        (name) => name !== "session.images",
      ),
    ).toContain("webhook");
    const result = WebhookSendResult.parse(await client.data("webhook.send", payload));
    expect(result).toEqual({ status: 200, retryAfterMs: null, refused: null });
    expect(posted).toEqual([{ url: URL_SECRET, body: '{"text":"hi"}' }]);
  });

  test("a refusal comes back as a result with its reason, not as an error", async () => {
    const { client, posted } = await served(true);
    const result = await client.data<{ refused: string }>("webhook.send", {
      ...payload,
      url: "http://hooks.slack.com/services/x",
    });
    expect(result?.refused).toBe("not_https");
    expect(posted).toHaveLength(0);
  });

  test("the URL is in no log line of the server or the sender", async () => {
    const { client, logs } = await served(true);
    await client.data("webhook.send", payload);
    await client.data("webhook.send", {
      ...payload,
      url: "http://hooks.slack.com/services/XXXXSECRETXXXX",
    });
    expect(logs.join("\n")).not.toContain("XXXXSECRETXXXX");
  });

  test("a host without it says the feature is off", async () => {
    const { client } = await served(false);
    const ack = (await client.request("webhook.send", payload)) as {
      ok: boolean;
      error?: { reason?: string };
    };
    expect(ack.ok).toBe(false);
    expect(ack.error?.reason).toBe("feature_off");
  });

  test("the command checks its payload", () => {
    const parse = (p: unknown) =>
      Command.safeParse({ id: "1", type: "webhook.send", payload: p }).success;
    expect(parse(payload)).toBe(true);
    expect(parse({ ...payload, url: "" })).toBe(false);
    expect(parse({ ...payload, headers: { a: 1 } })).toBe(false);
    expect(parse({ ...payload, body: "x".repeat(100_001) })).toBe(false);
    expect(parse({ ...payload, extra: 1 })).toBe(false);
  });
});
