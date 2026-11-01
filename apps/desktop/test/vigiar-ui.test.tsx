import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { settle } from "./wait.ts";

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

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

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

const round = (n: number, status: string, summary: string) => ({
  id: `r${n}`,
  cardId: "c1",
  n,
  status,
  trigger: { failed: ["CI"], conflicts: false, comments: [] },
  summary,
  sessionId: null,
  costUsd: 0.4,
  turns: 1,
  startedAt: "2026-10-31T12:05:00.000Z",
  endedAt: "2026-10-31T12:06:00.000Z",
});

/** The app on a daemon that watches PRs, on the screen of a card with an open PR. */
async function open(over: Record<string, unknown> = {}) {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("watch");
  daemon.watch.card = card(over);
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    daemon.push({ type: "card.updated", card: card(over) });
  });
  await act(async () => {
    store.router.push({ name: "card", host: hostId, projectId: "p1", cardId: "c1" });
  });
  await settle(() => screen.queryByRole("button", { name: "Voltar ao board" }) !== null);
  return { store, daemon, mem, hostId };
}

const sent = (daemon: Awaited<ReturnType<typeof open>>["daemon"], type: string) =>
  daemon.commands.filter((c) => c.type === type).map((c) => c.payload);

describe("vigiar-ui: watching and fixing a card's PR", () => {
  test("a card with an open PR has the switch, off by default; turning it on asks the host and says it is watching", async () => {
    const { daemon } = await open();
    const toggle = screen.queryByRole("checkbox", { name: "Vigiar e consertar" });
    expect(toggle).not.toBeNull();
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await act(async () => {
      fireEvent.click(toggle as HTMLElement);
    });
    await settle(() => sent(daemon, "watch.set").length > 0);
    expect(sent(daemon, "watch.set")).toEqual([{ cardId: "c1", enabled: true }]);
    await settle(() => screen.queryByText("Vigiando o PR") !== null);
    expect(screen.queryByText("Vigiando o PR")).not.toBeNull();
    expect(
      (screen.queryByRole("checkbox", { name: "Vigiar e consertar" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("a card with no PR has no switch", async () => {
    await open({ prUrl: null, prState: null });
    expect(screen.queryByRole("checkbox", { name: "Vigiar e consertar" })).toBeNull();
  });

  test("the rounds show with their result, and the reason a card asks for you shows with them", async () => {
    const mem = await open();
    mem.daemon.watch.info = {
      cardId: "c1",
      enabled: true,
      status: "needs_you",
      reason: "limit of 2 rounds reached",
      rounds: [round(1, "pushed", "pushed 1 commit(s)"), round(2, "failed", "local check failed")],
    };
    await act(async () => {
      mem.daemon.push({ type: "watch.updated", watch: mem.daemon.watch.info });
    });
    await settle(() => screen.queryByText(/Rodada 2/) !== null);
    expect(screen.queryByText("Rodada 1 · enviada")).not.toBeNull();
    expect(screen.queryByText("Rodada 2 · falhou")).not.toBeNull();
    expect(screen.queryByText("local check failed")).not.toBeNull();
    expect(screen.queryByText("Precisa de você: limit of 2 rounds reached")).not.toBeNull();
    // The card says it too: Voltar a vigiar starts the watch again from the card itself.
    await click("Voltar a vigiar");
    await settle(() => sent(mem.daemon, "watch.set").length > 0);
    expect(sent(mem.daemon, "watch.set")).toEqual([{ cardId: "c1", enabled: true }]);
  });

  test("a card that asks for you is in Precisa de você, with a notification, and Voltar a vigiar puts it back", async () => {
    const { store, daemon, mem } = await open();
    daemon.watch.info = {
      cardId: "c1",
      enabled: true,
      status: "needs_you",
      reason: "US$ 5.20 of US$ 5.00 spent on this PR",
      rounds: [round(1, "pushed", "pushed")],
    };
    await act(async () => {
      daemon.push({ type: "watch.updated", watch: daemon.watch.info });
    });
    await act(async () => {
      store.router.push({ name: "needs-you" });
    });
    const entry = /PR de Login: US\$ 5\.20 of US\$ 5\.00 spent on this PR/;
    await settle(() => screen.queryByRole("button", { name: entry }) !== null);
    expect(screen.queryByRole("button", { name: entry })).not.toBeNull();
    expect(mem.notifications).toContainEqual({
      title: "PR precisa de você",
      body: "Login: US$ 5.20 of US$ 5.00 spent on this PR",
    });
    await click(entry);
    await click("Voltar a vigiar");
    await settle(() => sent(daemon, "watch.set").length > 0);
    expect(sent(daemon, "watch.set")).toEqual([{ cardId: "c1", enabled: true }]);
    await act(async () => {
      daemon.push({ type: "watch.updated", watch: daemon.watch.info });
    });
    await settle(() => screen.queryByRole("button", { name: entry }) === null);
    expect(screen.queryByRole("button", { name: entry })).toBeNull();
  });
});

describe("vigiar-ui: a PR that asks for you leads to its card", () => {
  test("in Precisa de você, Abrir o card opens the card the PR belongs to", async () => {
    const { store, daemon } = await open();
    daemon.watch.info = {
      cardId: "c1",
      enabled: true,
      status: "needs_you",
      reason: "limit of 2 rounds reached",
      rounds: [round(1, "pushed", "pushed")],
    };
    await act(async () => {
      daemon.push({ type: "watch.updated", watch: daemon.watch.info });
    });
    await act(async () => {
      store.router.push({ name: "needs-you" });
    });
    const entry = /PR de Login: limit of 2 rounds reached/;
    await settle(() => screen.queryByRole("button", { name: entry }) !== null);
    await click(entry);
    await click("Abrir o card");
    expect(store.router.current).toMatchObject({ name: "card", cardId: "c1", projectId: "p1" });
  });
});

describe("vigiar-ui: the PR description is the person's to confirm", () => {
  test("Abrir PR only offers the generated text; nothing is opened until the person confirms the edited text", async () => {
    const { daemon } = await open({ prUrl: null, prState: null });
    daemon.watch.describe = { text: "## Login\n\nFazer o login", redacted: 0 };
    await click("Abrir PR");
    const box = await (async () => {
      await settle(() => screen.queryByRole("textbox", { name: "Descrição do PR" }) !== null);
      return screen.queryByRole("textbox", {
        name: "Descrição do PR",
      }) as HTMLTextAreaElement | null;
    })();
    expect(box).not.toBeNull();
    expect(box?.value).toBe("## Login\n\nFazer o login");
    expect(sent(daemon, "watch.describe")).toEqual([{ cardId: "c1" }]);
    expect(sent(daemon, "card.pr.create")).toEqual([]);
    await act(async () => {
      fireEvent.change(box as HTMLElement, { target: { value: "## Login\n\ntexto editado" } });
    });
    await click("Abrir o PR com este texto");
    await settle(() => sent(daemon, "card.pr.create").length > 0);
    expect(sent(daemon, "card.pr.create")).toEqual([
      { cardId: "c1", description: "## Login\n\ntexto editado" },
    ]);
  });

  test("lines taken out for looking like a secret are said so, and Cancelar opens nothing", async () => {
    const { daemon } = await open({ prUrl: null, prState: null });
    daemon.watch.describe = {
      text: "## Login\n\n[line removed: it looked like a secret]",
      redacted: 1,
    };
    await click("Abrir PR");
    await settle(() => screen.queryByText(/1 linha tirada/) !== null);
    expect(screen.queryByText("1 linha tirada por parecer um segredo")).not.toBeNull();
    await click("Cancelar");
    expect(screen.queryByRole("textbox", { name: "Descrição do PR" })).toBeNull();
    expect(sent(daemon, "card.pr.create")).toEqual([]);
  });

  test("Esc closes the description like Cancelar: nothing is opened", async () => {
    const { daemon } = await open({ prUrl: null, prState: null });
    daemon.watch.describe = { text: "## Login", redacted: 0 };
    await click("Abrir PR");
    await settle(() => screen.queryByRole("textbox", { name: "Descrição do PR" }) !== null);
    const box = screen.queryByRole("textbox", { name: "Descrição do PR" });
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(box as HTMLElement, { key: "Escape" });
    });
    await settle(() => screen.queryByRole("textbox", { name: "Descrição do PR" }) === null);
    expect(screen.queryByRole("textbox", { name: "Descrição do PR" })).toBeNull();
    expect(sent(daemon, "card.pr.create")).toEqual([]);
  });

  test("two lines taken out say so in the plural", async () => {
    const { daemon } = await open({ prUrl: null, prState: null });
    daemon.watch.describe = { text: "## Login", redacted: 2 };
    await click("Abrir PR");
    await settle(() => screen.queryByText(/2 linhas tiradas/) !== null);
    expect(screen.queryByText("2 linhas tiradas por parecerem segredos")).not.toBeNull();
  });
});
