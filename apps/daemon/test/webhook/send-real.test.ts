import { describe, expect, test } from "bun:test";
import type { WebhookRequest } from "../../src/webhook/domain/webhook-guard.ts";
import { WebhookSender } from "../../src/webhook/sender.ts";

const request = (over: Partial<WebhookRequest> = {}): WebhookRequest => ({
  url: "https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX",
  headers: { "Content-Type": "application/json", "X-Flightdeck-Event": "needs_you" },
  body: '{"text":"hi"}',
  ...over,
});

describe("webhook-enviar: the real resolver and fetch, on this machine", () => {
  test("a post to a local server over http by the name localhost arrives with its body", async () => {
    const seen: Array<{ method: string; body: string; event: string | null }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        seen.push({
          method: req.method,
          body: await req.text(),
          event: req.headers.get("X-Flightdeck-Event"),
        });
        return new Response("ok", { status: 202 });
      },
    });
    try {
      const outcome = await new WebhookSender().send(
        request({ url: `http://localhost:${server.port}/hook` }),
        "127.0.0.1",
      );
      expect(outcome).toEqual({ status: 202, retryAfterMs: null, refused: null });
      expect(seen).toEqual([{ method: "POST", body: '{"text":"hi"}', event: "needs_you" }]);
    } finally {
      await server.stop(true);
    }
  });

  test("a name that cannot be resolved is refused", async () => {
    const outcome = await new WebhookSender().send(
      request({ url: "https://no-such-host.invalid/x" }),
      "127.0.0.1",
    );
    expect(outcome.refused).toBe("unresolved");
  });
});
