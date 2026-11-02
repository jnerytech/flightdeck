import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Budgets } from "../../daemon/src/costs/budgets.ts";
import { WebhookSender } from "../../daemon/src/webhook/sender.ts";
import { registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settleMaybe, waiter } from "./wait.ts";

registerDom();
const { act, cleanup } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);
const TODAY = "2026-10-15";
const START = Date.UTC(2026, 9, 15, 12);
const SESSION = "dddddddd-0000-4000-8000-000000000030";

async function online(options: { summary?: boolean; budgets?: boolean } = {}) {
  let budgets: Budgets | null = null;
  const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const sender = new WebhookSender({
    resolve: async (host) => (host.startsWith("internal") ? ["10.0.0.1"] : ["93.184.216.34"]),
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response("", { status: 200 });
    }) as never,
  });
  const d = makeDaemon(cleanups, {
    webhook: sender,
    ...(options.summary ? { summary: true } : {}),
    ...(options.budgets
      ? {
          costs: true,
          budgets: (db) => {
            budgets = new Budgets({ db, now: () => START, day: () => TODAY });
            return budgets;
          },
        }
      : {}),
  });
  const server = d.listen();
  const mem = memoryPlatform(false);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => START,
    day: () => TODAY,
  });
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.hostInfo !== null);
  return { d, mem, store, sent, budgets: budgets as unknown as Budgets };
}

describe("webhook-app", () => {
  test("a budget threshold reaches a webhook target, with the host and the figures", async () => {
    const { d, store, sent, budgets } = await online({ budgets: true });
    d.eventStore.db
      .query(
        `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin,
           speed, input, output, cache_read, cache_write_5m, cache_write_1h, cost_usd)
         VALUES ('b1', 's', ?, ?, 'kA', 'claude-opus-5-5', 'terminal', 'standard', 1, 1, 0, 0, 0, 6)`,
      )
      .run(`${TODAY}T12:00:00.000Z`, TODAY);
    await store.webhooks.targets.add({
      name: "team",
      type: "slack",
      url: "https://hooks.slack.com/services/T/B/SECRET",
      hostScope: null,
      kinds: ["budget_alert"],
      clientId: null,
    });
    await act(async () => {
      budgets.set({ scope: "host", period: "day", limitUsd: 10, action: "notify" });
    });
    expect(await settleMaybe(() => sent.length > 0)).toBe(true);
    expect(sent[0]?.url).toBe("https://hooks.slack.com/services/T/B/SECRET");
    const body = JSON.parse(sent[0]?.body ?? "{}") as { text: string };
    expect(body.text).toContain("budget alert");
    expect(JSON.stringify(body)).toContain("50% of US$ 10.00");
  });

  test("the sample goes through the host; a URL it refuses counts as a permanent 400", async () => {
    const { store, sent } = await online();
    const good = await store.webhooks.targets.add({
      name: "good",
      type: "slack",
      url: "https://hooks.slack.com/services/T/B/OK",
      hostScope: null,
      kinds: ["needs_you"],
      clientId: null,
    });
    expect(await store.webhooks.test(good.id)).toMatchObject({ ok: true, httpStatus: 200 });
    expect(sent).toHaveLength(1);
    const internal = await store.webhooks.targets.add({
      name: "internal",
      type: "slack",
      url: "https://internal.example/hook",
      hostScope: null,
      kinds: ["needs_you"],
      clientId: null,
    });
    expect(await store.webhooks.test(internal.id)).toMatchObject({ ok: false, httpStatus: 400 });
    expect(sent).toHaveLength(1);
  });

  test("with no online host that can post, the test finds no answer", async () => {
    const legacy = legacyDaemon(cleanups);
    const mem = memoryPlatform(false);
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => START });
    await act(async () => {
      await store.addHost({ name: "alfa", url: legacy.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const target = await store.webhooks.targets.add({
      name: "t",
      type: "slack",
      url: "https://hooks.slack.com/services/T/B/OK",
      hostScope: null,
      kinds: ["needs_you"],
      clientId: null,
    });
    expect(await store.webhooks.test(target.id)).toMatchObject({ ok: false, httpStatus: null });
    expect(store.webhooks.supported()).toBe(true);
    expect(legacy.asked.includes("webhook.send")).toBe(false);
  });

  test("sessionRecap asks the host for the summary of a session it indexed", async () => {
    const { d, store } = await online({ summary: true });
    mkdirSync(d.historyRoot, { recursive: true });
    const file = join(d.historyRoot, `${SESSION}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({ type: "user", message: { role: "user", content: "Add a retry" } })}\n`,
    );
    d.eventStore.db
      .query(
        `INSERT INTO history_sessions (claude_session_id, cwd, title, first_ts, last_ts, message_count, origin, file_path)
         VALUES (?, '/work/app', 't', '2026-11-01T12:00:00.000Z', '2026-11-01T12:01:30.000Z', 1, 'external', ?)`,
      )
      .run(SESSION, file);
    const hostId = store.getState().hosts[0]?.id as string;
    const recap = await store.sessionRecap(hostId, SESSION, { question: "Run it?" });
    expect(recap).toMatchObject({
      asked: "Add a retry",
      question: "Run it?",
      source: "transcript",
    });
    expect(await store.sessionRecap(hostId, "unknown-session")).toBeNull();
    expect(await store.sessionRecap("no-such-host", SESSION)).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  test("a host without the feature gives no summary and asks nothing", async () => {
    const legacy = legacyDaemon(cleanups);
    const mem = memoryPlatform(false);
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => START });
    await act(async () => {
      await store.addHost({ name: "alfa", url: legacy.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const hostId = store.getState().hosts[0]?.id as string;
    expect(await store.sessionRecap(hostId, SESSION)).toBeNull();
    expect(legacy.asked.includes("session.summary")).toBe(false);
  });
});
