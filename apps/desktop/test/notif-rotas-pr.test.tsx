import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const PR = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";
const card = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  projectId: "p1",
  title: "Login",
  description: "Fazer o login",
  column: "review",
  columnLocked: false,
  position: 1,
  slug: "login",
  branch: "fd/login",
  worktreePath: "/w/login",
  prUrl: PR,
  prState: "open",
  checksState: null,
  queued: false,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  discarded: false,
  runs: [],
  workflowRunId: null,
  arenaOf: null,
  variant: null,
  arenaVariants: 0,
  issueRef: null,
  issueExternal: false,
  queueReason: null,
  quotaUntil: null,
  createdAt: "2026-10-31T12:00:00.000Z",
  updatedAt: "2026-10-31T12:00:00.000Z",
  ...over,
});

async function open() {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("watch");
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, daemon };
}

const entryOf = (store: InstanceType<typeof AppStore>, title: RegExp) =>
  store.getState().inbox.find((e) => title.test(e.title + e.body));

describe("notif-rotas: the pull request a card entry falls back to", () => {
  test("a PR-watch alert on a card with a PR keeps the PR link", async () => {
    const { store, daemon } = await open();
    await act(async () => {
      daemon.push({ type: "card.updated", card: card() });
    });
    await act(async () => {
      daemon.push({
        type: "watch.updated",
        watch: { cardId: "c1", enabled: true, status: "needs_you", reason: "limite", rounds: [] },
      });
    });
    await settle(() => entryOf(store, /Login: limite/) !== undefined);
    expect(entryOf(store, /Login: limite/)?.fallbackUrl).toBe(PR);
  });

  test("an unblocked card keeps its PR link, and one with no PR keeps none", async () => {
    const { store, daemon } = await open();
    await act(async () => {
      daemon.push({ type: "card.updated", card: card({ id: "c2", title: "Com PR" }) });
      daemon.push({
        type: "card.updated",
        card: card({ id: "c3", title: "Sem PR", prUrl: null, prState: null }),
      });
    });
    await act(async () => {
      daemon.push({
        type: "card.updated",
        card: card({ id: "c2", title: "Com PR", unblockedAt: "2026-11-03T10:00:00.000Z" }),
      });
      daemon.push({
        type: "card.updated",
        card: card({
          id: "c3",
          title: "Sem PR",
          prUrl: null,
          prState: null,
          unblockedAt: "2026-11-03T10:00:00.000Z",
        }),
      });
    });
    await settle(
      () => entryOf(store, /Sem PR/) !== undefined && entryOf(store, /Com PR/) !== undefined,
    );
    expect(entryOf(store, /Com PR/)?.fallbackUrl).toBe(PR);
    expect(entryOf(store, /Sem PR/)).not.toBeUndefined();
    expect(entryOf(store, /Sem PR/)).not.toHaveProperty("fallbackUrl");
  });
});
