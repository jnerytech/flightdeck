import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const PR = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";
const OPEN_PR = "Abrir o PR do link";

const card = {
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
};

const trace = {
  cardId: "c1",
  title: "Login",
  prUrl: PR,
  workItem: "AB#12",
  sessions: [],
  rounds: [],
  costUsd: null,
};

async function open(features: string[] = ["watch"]) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.watch.card = card;
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, daemon };
}

const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
const options = () => (dialog() ? within(dialog() as HTMLElement).queryAllByRole("option") : []);
const labels = () => options().map((o) => o.getAttribute("aria-label"));

async function typeQuery(text: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const input = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  return input;
}

const asked = (daemon: Awaited<ReturnType<typeof open>>["daemon"]) =>
  daemon.commands.filter((c) => c.type === "watch.byUrl").map((c) => c.payload);

describe("rastro-paleta: a pasted PR link opens what was made for it", () => {
  test("the link is offered as an entry; Enter asks the host and opens the card the PR belongs to", async () => {
    const { store, daemon } = await open();
    daemon.watch.byUrl = { via: "card", trace, sessions: [] };
    const input = await typeQuery(`  ${PR}?_a=overview `);
    expect(labels()).toContain(OPEN_PR);
    expect(asked(daemon)).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await settle(() => store.router.current.name === "card");
    expect(asked(daemon)).toEqual([{ url: `${PR}?_a=overview` }]);
    expect(store.router.current).toMatchObject({
      name: "card",
      projectId: "p1",
      cardId: "c1",
    });
    expect(dialog()).toBeNull();
  });

  test("a PR the history knows from sessions only opens the first session's transcript", async () => {
    const { store, daemon } = await open();
    daemon.watch.byUrl = {
      via: "history",
      trace: null,
      sessions: [{ claudeSessionId: "cs-1", title: "old fix", cwd: "/w/old" }],
    };
    const input = await typeQuery(PR);
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await settle(() => store.router.current.name === "reader");
    expect(store.router.current).toMatchObject({
      name: "reader",
      target: { claudeSessionId: "cs-1" },
    });
  });

  test("a PR nothing knows says so and opens nothing", async () => {
    const { store, daemon } = await open();
    const input = await typeQuery(PR);
    const before = JSON.stringify(store.router.current);
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await settle(() => asked(daemon).length > 0);
    await settle(() => screen.queryByText("Nenhum card ou sessão tem esse PR") !== null);
    expect(screen.queryByText("Nenhum card ou sessão tem esse PR")).not.toBeNull();
    expect(JSON.stringify(store.router.current)).toBe(before);
  });

  test("text that is not a PR link, or a host that does not watch PRs, offers no such entry", async () => {
    const { daemon } = await open();
    await typeQuery("https://example.com/not-a-pr");
    expect(labels()).not.toContain(OPEN_PR);
    expect(asked(daemon)).toEqual([]);
    cleanup();
    for (const fn of cleanups.splice(0).reverse()) await fn();
    await open([]);
    await typeQuery(PR);
    expect(labels()).not.toContain(OPEN_PR);
  });
});
