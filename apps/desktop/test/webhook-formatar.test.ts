import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  formatWebhook,
  type NotifyEvent,
  ntfyTopic,
  type WebhookKind,
} from "../src/lib/webhook-format.ts";

const event = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  id: "01JEVENT0000000000000000AA",
  kind: "needs_you",
  host: "pi",
  project: "github.com/acme/api",
  title: "Fix the build",
  at: "2026-11-02T10:00:00.000Z",
  detail: "Run `rm -rf build`?",
  summary: {
    asked: "Fix the build",
    done: "Patched the config.",
    files: ["/r/a.ts", "/r/b.ts"],
    filesMore: 3,
    costUsd: 1.5,
    question: "Run `rm -rf build`?",
    state: "waiting",
    source: "transcript",
  },
  ...over,
});

const KINDS: WebhookKind[] = [
  "needs_you",
  "session_ended",
  "session_failed",
  "budget_alert",
  "pr_watch",
];

const LABEL: Record<WebhookKind, string> = {
  needs_you: "needs you",
  session_ended: "session ended",
  session_failed: "session failed",
  budget_alert: "budget alert",
  pr_watch: "PR watch",
};

describe("webhook-formatar: Slack", () => {
  test("it posts JSON with the text and the summary for every kind", async () => {
    for (const kind of KINDS) {
      const out = await formatWebhook("slack", event({ kind }));
      expect(out.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(out.body) as { text: string; blocks: unknown[] };
      expect(body.text).toContain("Fix the build");
      expect(body.text).toContain("pi");
      expect(body.text).toContain(LABEL[kind]);
      expect(body.blocks.length).toBeGreaterThan(0);
    }
  });

  test("the summary is in the blocks: asked, done, files, cost and the question", async () => {
    const out = await formatWebhook("slack", event());
    const text = JSON.stringify(JSON.parse(out.body).blocks);
    for (const part of ["Fix the build", "Patched the config.", "/r/a.ts", "and 3 more", "$1.50"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("rm -rf build");
  });

  test("a title cannot ping a channel or open a link: <, > and & are escaped", async () => {
    const out = await formatWebhook("slack", event({ title: "<!channel> <https://x|y> a&b" }));
    expect(out.body).not.toContain("<!channel>");
    expect(out.body).toContain("&lt;!channel&gt;");
    expect(out.body).toContain("a&amp;b");
  });
});

describe("webhook-formatar: Discord", () => {
  test("it posts content and one embed, and pings nobody", async () => {
    const out = await formatWebhook("discord", event({ title: "@everyone hello <@123>" }));
    const body = JSON.parse(out.body) as {
      content: string;
      embeds: Array<{ title: string; description: string }>;
      allowed_mentions: { parse: string[] };
    };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds).toHaveLength(1);
    expect(body.content).not.toContain("@everyone");
    expect(body.content).toContain("pi");
    expect(body.embeds[0]?.description).toContain("Patched the config.");
  });

  test("content stays within 2000 characters, the embed title within 256 and description within 4096", async () => {
    const huge = "x".repeat(10_000);
    const out = await formatWebhook(
      "discord",
      event({
        title: huge,
        detail: huge,
        summary: { ...event().summary, asked: huge, done: huge, question: huge } as never,
      }),
    );
    const body = JSON.parse(out.body);
    expect(body.content.length).toBeLessThanOrEqual(2000);
    expect(body.embeds[0].title.length).toBeLessThanOrEqual(256);
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
  });
});

describe("webhook-formatar: generic", () => {
  test("it posts the envelope with the event, the delivery id and the timestamp", async () => {
    const out = await formatWebhook("generic", event(), {
      signingSecret: "s3cret",
      now: () => 1_793_534_000_000,
    });
    expect(out.headers["X-Flightdeck-Event"]).toBe("needs_you");
    expect(out.headers["X-Flightdeck-Delivery"]).toBe("01JEVENT0000000000000000AA");
    expect(out.headers["X-Flightdeck-Timestamp"]).toBe("1793534000");
    const body = JSON.parse(out.body);
    expect(body).toMatchObject({
      id: "01JEVENT0000000000000000AA",
      kind: "needs_you",
      host: "pi",
      project: "github.com/acme/api",
      title: "Fix the build",
      at: "2026-11-02T10:00:00.000Z",
      detail: "Run `rm -rf build`?",
    });
    expect(body.summary.asked).toBe("Fix the build");
  });

  test("the signature is HMAC-SHA256 of `timestamp.body` with the signing secret", async () => {
    const out = await formatWebhook("generic", event(), {
      signingSecret: "s3cret",
      now: () => 1_793_534_000_000,
    });
    const expected = createHmac("sha256", "s3cret").update(`1793534000.${out.body}`).digest("hex");
    expect(out.headers["X-Flightdeck-Signature"]).toBe(`sha256=${expected}`);
  });

  test("a different timestamp or body gives a different signature", async () => {
    const at = (ms: number, e = event()) =>
      formatWebhook("generic", e, { signingSecret: "k", now: () => ms });
    const base = (await at(1_000_000)).headers["X-Flightdeck-Signature"];
    expect((await at(2_000_000)).headers["X-Flightdeck-Signature"]).not.toBe(base);
    expect(
      (await at(1_000_000, event({ title: "other" }))).headers["X-Flightdeck-Signature"],
    ).not.toBe(base);
  });

  test("without a signing secret there is no signature header", async () => {
    const out = await formatWebhook("generic", event());
    expect(out.headers["X-Flightdeck-Signature"]).toBeUndefined();
    expect(out.headers["X-Flightdeck-Timestamp"]).toBeDefined();
  });
});

describe("webhook-formatar: ntfy, one-way phone notices (#263)", () => {
  const url = "https://ntfy.example.com/fd-alerts";

  test("ntfy gets its JSON publish at the server's root: the topic, the headline, the lines and the priority", async () => {
    const out = await formatWebhook("ntfy", event(), { url });
    expect(out.url).toBe("https://ntfy.example.com/");
    expect(out.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(out.body)).toEqual({
      topic: "fd-alerts",
      title: "needs you: Fix the build (pi)",
      message: [
        "Asked: Fix the build",
        "Done: Patched the config.",
        "Files: /r/a.ts, /r/b.ts and 3 more",
        "Cost: $1.50",
        "Question: Run `rm -rf build`?",
      ].join("\n"),
      priority: 4,
      tags: ["bell"],
    });
  });

  test("only needs you is high; every other kind is the default priority, and a tap opens nothing", async () => {
    for (const kind of KINDS) {
      const body = JSON.parse((await formatWebhook("ntfy", event({ kind }), { url })).body);
      expect(body.priority, kind).toBe(kind === "needs_you" ? 4 : 3);
      expect([body.click, body.actions, body.attach], kind).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }
    const bare = JSON.parse(
      (await formatWebhook("ntfy", event({ summary: null, detail: null }), { url })).body,
    );
    expect(bare.message).toBe("Fix the build");
  });

  test("an access token goes as Authorization: Bearer, and a self-hosted server keeps its port", async () => {
    const out = await formatWebhook("ntfy", event(), {
      url: "https://push.home.example:8443/flightdeck_1",
      signingSecret: "tk_abc123",
    });
    expect(out.url).toBe("https://push.home.example:8443/");
    expect(out.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer tk_abc123",
    });
    expect(JSON.parse(out.body).topic).toBe("flightdeck_1");
  });

  test("ntfyTopic splits a topic URL; anything but one plain topic segment is null", () => {
    expect(ntfyTopic("https://ntfy.sh/my-topic")).toEqual({
      server: "https://ntfy.sh/",
      topic: "my-topic",
    });
    for (const bad of [
      "https://ntfy.sh/",
      "https://ntfy.sh/a/b",
      "https://ntfy.sh/a?x=1",
      "https://ntfy.sh/a#x",
      "https://ntfy.sh/a.b",
      `https://ntfy.sh/${"t".repeat(65)}`,
      "not a url",
    ]) {
      expect(ntfyTopic(bad), bad).toBeNull();
    }
  });
});
