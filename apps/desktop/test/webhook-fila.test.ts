import { describe, expect, test } from "bun:test";
import type { NotifyEvent } from "../src/lib/webhook-format.ts";
import { delay, type SendResult, WebhookQueue } from "../src/lib/webhook-queue.ts";

const event = (id: string, over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  id,
  kind: "needs_you",
  host: "pi",
  project: null,
  title: `session ${id}`,
  at: "2026-11-02T10:00:00.000Z",
  summary: null,
  detail: null,
  ...over,
});

function setup(answers: Array<SendResult | "throw"> = [], over: { maxQueue?: number } = {}) {
  let clock = 0;
  const sent: Array<{ at: number; target: string; event: NotifyEvent }> = [];
  const sleeps: number[] = [];
  const results: Array<{ target: string; ok: boolean; status: number | null }> = [];
  const script = [...answers];
  const queue = new WebhookQueue({
    send: async (target, e) => {
      sent.push({ at: clock, target, event: e });
      const next = script.shift() ?? { status: 200 };
      if (next === "throw") throw new Error("network");
      return next;
    },
    onResult: (target, r) => results.push({ target, ok: r.ok, status: r.httpStatus }),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0.5,
    ...over,
  });
  return { queue, sent, sleeps, results };
}

describe("webhook-fila", () => {
  test("a good send reports ok once and the queue goes idle", async () => {
    const { queue, sent, results } = setup();
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(1);
    expect(results).toEqual([{ target: "a", ok: true, status: 200 }]);
  });

  test("sends to one target are paced at least one second apart", async () => {
    const { queue, sent } = setup();
    queue.enqueue("a", event("1", { kind: "session_ended" }));
    queue.enqueue("a", event("2", { kind: "budget_alert" }));
    queue.enqueue("a", event("3", { kind: "pr_watch" }));
    await queue.idle();
    expect(sent.map((s) => s.at)).toEqual([0, 1000, 2000]);
  });

  test("targets are independent: another target is not held back by one", async () => {
    const { queue, sent } = setup();
    queue.enqueue("a", event("1"));
    queue.enqueue("b", event("2"));
    await queue.idle();
    expect(sent.map((s) => [s.target, s.at])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  test("events of the same kind waiting together are merged into one message", async () => {
    const { queue, sent } = setup();
    queue.enqueue("a", event("1", { title: "api" }));
    queue.enqueue("a", event("2", { title: "web" }));
    queue.enqueue("a", event("3", { title: "docs" }));
    await queue.idle();
    // The first goes out at once; the two that waited behind it become one message.
    expect(sent).toHaveLength(2);
    expect(sent[1]?.event.title).toBe("2 × needs you");
    expect(sent[1]?.event.detail).toBe("web; docs");
    expect(sent[1]?.event.id).toBe("3");
    expect(sent[1]?.event.summary).toBeNull();
  });

  test("a network error and 5xx are retried with the backoff 2 s, 8 s, 32 s, then it gives up", async () => {
    const { queue, sent, sleeps, results } = setup([
      "throw",
      { status: 500 },
      { status: 502 },
      { status: 503 },
    ]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(4);
    expect(sleeps).toEqual([2000, 8000, 32000]);
    expect(results).toEqual([{ target: "a", ok: false, status: 503 }]);
  });

  test("it recovers when a retry works", async () => {
    const { queue, sent, results } = setup([{ status: 500 }, { status: 200 }]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(2);
    expect(results).toEqual([{ target: "a", ok: true, status: 200 }]);
  });

  test("the jitter moves the wait within a quarter either way", async () => {
    for (const [random, expected] of [
      [0, 1500],
      [0.999, 2499],
    ] as const) {
      let waited = 0;
      const queue = new WebhookQueue({
        send: (async () => ({ status: waited ? 200 : 500 })) as never,
        onResult: () => {},
        sleep: async (ms) => {
          waited = ms;
        },
        random: () => random,
        minIntervalMs: 0,
      });
      queue.enqueue("a", event("1"));
      await queue.idle();
      expect(Math.round(waited)).toBe(expected);
    }
  });

  test("429 honors Retry-After when it is longer than the backoff", async () => {
    const { queue, sleeps } = setup([{ status: 429, retryAfterMs: 20_000 }, { status: 200 }]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sleeps).toEqual([20_000]);
    const short = setup([{ status: 429, retryAfterMs: 100 }, { status: 200 }]);
    short.queue.enqueue("a", event("1"));
    await short.queue.idle();
    expect(short.sleeps).toEqual([2000]);
  });

  test("a permanent 4xx stops at once, marks failing and blocks the target until unblocked", async () => {
    const { queue, sent, results } = setup([{ status: 404 }]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(1);
    expect(results).toEqual([{ target: "a", ok: false, status: 404 }]);
    queue.enqueue("a", event("2"));
    await queue.idle();
    expect(sent).toHaveLength(1);
    expect(queue.stats().skipped).toBe(1);
    queue.unblock("a");
    queue.enqueue("a", event("3"));
    await queue.idle();
    expect(sent).toHaveLength(2);
  });

  test("a redirect is permanent too: it is never followed, so waiting does not help", async () => {
    const { queue, sent, results } = setup([{ status: 302 }]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(1);
    expect(results).toEqual([{ target: "a", ok: false, status: 302 }]);
  });

  test("408 and 429 are not permanent", async () => {
    const { queue, sent } = setup([{ status: 408 }, { status: 429 }, { status: 200 }]);
    queue.enqueue("a", event("1"));
    await queue.idle();
    expect(sent).toHaveLength(3);
  });

  test("the queue is bounded: the oldest are dropped and counted", async () => {
    const { queue, sent } = setup([], { maxQueue: 3 });
    // Distinct kinds so nothing merges; the first is already being sent.
    const kinds = [
      "needs_you",
      "session_ended",
      "session_failed",
      "budget_alert",
      "pr_watch",
    ] as const;
    for (const [i, kind] of kinds.entries()) queue.enqueue("a", event(String(i), { kind }));
    await queue.idle();
    expect(queue.stats().dropped).toBe(1);
    expect(sent.map((s) => s.event.id)).toEqual(["0", "2", "3", "4"]);
  });

  test("delay waits for the time given", async () => {
    const before = Date.now();
    await delay(15);
    expect(Date.now() - before).toBeGreaterThanOrEqual(10);
  });
});
