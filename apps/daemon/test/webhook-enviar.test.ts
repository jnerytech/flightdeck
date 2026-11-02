import { describe, expect, test } from "bun:test";
import { isPublicAddress, type WebhookRequest, WebhookSender } from "../src/webhook/sender.ts";

const SECRET_URL = "https://hooks.slack.com/services/T000/B000/XXXXSECRETXXXX";

const request = (over: Partial<WebhookRequest> = {}): WebhookRequest => ({
  url: SECRET_URL,
  headers: { "Content-Type": "application/json", "X-Flightdeck-Event": "needs_you" },
  body: '{"text":"hi"}',
  ...over,
});

interface Call {
  url: string;
  init: RequestInit;
}

function setup(
  over: {
    answer?: Response | "throw" | "hang";
    resolved?: string[] | "throw";
    timeoutMs?: number;
  } = {},
) {
  const calls: Call[] = [];
  const resolved: string[] = [];
  const logs: string[] = [];
  const sender = new WebhookSender({
    resolve: async (host) => {
      resolved.push(host);
      if (over.resolved === "throw") throw new Error("ENOTFOUND");
      return over.resolved ?? ["93.184.216.34"];
    },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (over.answer === "throw") throw new Error("connect failed");
      if (over.answer === "hang") {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return over.answer ?? new Response("ok", { status: 200 });
    }) as never,
    timeoutMs: over.timeoutMs ?? 10_000,
    log: (message) => logs.push(message),
  });
  return { sender, calls, resolved, logs };
}

describe("webhook-enviar", () => {
  test("it posts the body with the headers, follows no redirect and gives back the status only", async () => {
    const { sender, calls } = setup({ answer: new Response("secret body", { status: 204 }) });
    const outcome = await sender.send(request(), "127.0.0.1");
    expect(outcome).toEqual({ status: 204, retryAfterMs: null, refused: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SECRET_URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[0]?.init.body).toBe('{"text":"hi"}');
    expect(calls[0]?.init.headers).toEqual(request().headers);
  });

  test("a redirect answer is returned as it is, not followed", async () => {
    const { sender, calls } = setup({
      answer: new Response(null, { status: 302, headers: { Location: "http://10.0.0.1/" } }),
    });
    expect((await sender.send(request(), "127.0.0.1")).status).toBe(302);
    expect(calls).toHaveLength(1);
  });

  test("Retry-After in seconds becomes milliseconds; anything else is null", async () => {
    const wait = async (value: string) =>
      (
        await setup({
          answer: new Response("", { status: 429, headers: { "Retry-After": value } }),
        }).sender.send(request(), "127.0.0.1")
      ).retryAfterMs;
    expect(await wait("3")).toBe(3000);
    expect(await wait("1.5")).toBe(1500);
    expect(await wait("soon")).toBeNull();
    expect(await wait("-4")).toBeNull();
  });

  test("a failing connection and a timeout give no status and are not refusals", async () => {
    expect(await setup({ answer: "throw" }).sender.send(request(), "127.0.0.1")).toEqual({
      status: null,
      retryAfterMs: null,
      refused: null,
    });
    const slow = setup({ answer: "hang", timeoutMs: 20 });
    expect(await slow.sender.send(request(), "127.0.0.1")).toEqual({
      status: null,
      retryAfterMs: null,
      refused: null,
    });
  });

  test("the URL must be https; http only to a loopback name; no credentials; nothing is fetched otherwise", async () => {
    const refusals: Array<[string, string]> = [
      ["http://hooks.slack.com/x", "not_https"],
      ["ftp://example.com/x", "invalid_url"],
      ["not a url", "invalid_url"],
      ["https://user:pw@example.com/x", "credentials"],
      ["https://127.0.0.1/x", "private_address"],
    ];
    for (const [url, refused] of refusals) {
      const { sender, calls } = setup({ resolved: ["127.0.0.1"] });
      const outcome = await sender.send(request({ url }), "127.0.0.1");
      expect(outcome).toEqual({ status: null, retryAfterMs: null, refused });
      expect(calls).toHaveLength(0);
    }
  });

  test("http to localhost, 127.0.0.1 or [::1] is allowed when the name really is loopback", async () => {
    for (const [url, address] of [
      ["http://localhost:9000/h", "127.0.0.1"],
      ["http://127.0.0.1:9000/h", "127.0.0.1"],
      ["http://[::1]:9000/h", "::1"],
    ] as const) {
      const { sender, calls } = setup({ resolved: [address] });
      expect((await sender.send(request({ url }), "127.0.0.1")).refused).toBeNull();
      expect(calls).toHaveLength(1);
    }
    const lying = setup({ resolved: ["10.0.0.1"] });
    expect(
      (await lying.sender.send(request({ url: "http://localhost:9/h" }), "127.0.0.1")).refused,
    ).toBe("private_address");
  });

  test("a name that resolves to a private address, even among public ones, is refused (SSRF)", async () => {
    for (const resolved of [
      ["10.0.0.5"],
      ["93.184.216.34", "192.168.1.10"],
      ["169.254.169.254"],
      ["::1"],
      ["fd00::1"],
      ["::ffff:10.0.0.1"],
    ]) {
      const { sender, calls } = setup({ resolved });
      const outcome = await sender.send(request(), "127.0.0.1");
      expect(outcome.refused).toBe("private_address");
      expect(calls).toHaveLength(0);
    }
  });

  test("an address written in the URL is checked without asking DNS", async () => {
    const { sender, resolved, calls } = setup();
    const outcome = await sender.send(request({ url: "https://10.1.2.3/hook" }), "127.0.0.1");
    expect(outcome.refused).toBe("private_address");
    expect(resolved).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(
      (await sender.send(request({ url: "https://93.184.216.34/hook" }), "127.0.0.1")).refused,
    ).toBeNull();
  });

  test("a name that does not resolve is refused as unresolved", async () => {
    for (const resolved of ["throw", []] as Array<"throw" | string[]>) {
      const { sender, calls } = setup({ resolved });
      expect((await sender.send(request(), "127.0.0.1")).refused).toBe("unresolved");
      expect(calls).toHaveLength(0);
    }
  });

  test("only Content-Type and X-Flightdeck-* headers go out, and the body is capped at 100 KB", async () => {
    const { sender, calls } = setup();
    const bad: Array<Record<string, string>> = [
      { Authorization: "x" },
      { Host: "evil" },
      { "Content-Type": "a\nb" },
    ];
    for (const headers of bad) {
      expect((await sender.send(request({ headers }), "127.0.0.1")).refused).toBe("bad_header");
    }
    expect((await sender.send(request({ body: "x".repeat(100_001) }), "127.0.0.1")).refused).toBe(
      "body_too_large",
    );
    expect(calls).toHaveLength(0);
  });

  test("from outside loopback and Tailscale it is refused before anything else, and the URL is in no log line", async () => {
    const { sender, calls, resolved, logs } = setup();
    await expect(sender.send(request(), "8.8.8.8")).rejects.toMatchObject({
      reason: "transport_refused",
    });
    expect(calls).toHaveLength(0);
    expect(resolved).toEqual([]);
    await sender.send(
      request({ url: "http://hooks.slack.com/services/XXXXSECRETXXXX" }),
      "127.0.0.1",
    );
    await sender.send(request(), "127.0.0.1");
    for (const line of logs) expect(line).not.toContain("XXXXSECRETXXXX");
  });
});

describe("webhook-enviar: which addresses are public", () => {
  test("private, loopback, link-local, CGNAT, multicast and unspecified are not", () => {
    for (const address of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:192.168.1.1",
      "not an address",
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  test("ordinary public addresses are", () => {
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPublicAddress(address)).toBe(true);
    }
  });
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
