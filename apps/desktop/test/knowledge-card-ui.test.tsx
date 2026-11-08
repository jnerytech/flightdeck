import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { KnowledgeEntry } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #78, slice S-T2: a spec in the project's documents becomes a card that names it, so the
 * card's first start reads it first and works test first (S-T1).
 */
const entry = (path: string, over: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  path,
  title: path,
  type: "spec",
  status: "valid",
  supersedes: null,
  bytes: 1200,
  changedAt: "2026-11-05T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: "h",
  ...over,
});

const LIST = {
  truncated: false,
  entries: [
    entry("docs/specs/login.md", { title: "Login screen" }),
    entry("docs/adr/0001-queue.md", { title: "Use a queue", type: "adr" }),
  ],
};

function setup(
  options: { language?: "en" | "pt-BR"; refuse?: boolean; refuseName?: boolean } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  store.loadProjects = (async () => []) as never;
  store.refreshHub = (async () => {}) as never;
  const sent: Array<[string, unknown]> = [];
  store.hostCommand = (async (_host: string, type: string, payload: unknown) => {
    sent.push([type, payload]);
    if (type === "knowledge.list") return LIST;
    if (type === "card.create") {
      return options.refuse ? null : { id: "c9", title: (payload as { title: string }).title };
    }
    if (type === "card.update") return options.refuseName ? null : { id: "c9" };
    return null;
  }) as never;
  const went: unknown[] = [];
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: ["knowledge"] },
        sessions: [],
      },
    ],
    projects: { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "main" }] },
  } as never as ReturnType<typeof store.getState>;
  const view = (
    <ProjectPage
      store={store}
      state={state}
      hostId="h1"
      projectId="p1"
      go={(route) => went.push(route)}
    />
  );
  return { view, sent, went, store };
}

const listed = (title = "Login screen") =>
  settle(() => screen.queryByText(title) !== null, 5000, "the documents");
/** The row of the document with this title. */
const row = (title: string) => screen.queryByText(title)?.closest("li") ?? null;
/** Each row's button says which spec it makes a card of, for a screen reader too. */
const makeCard = (title: string, name = `Make a card from ${title}`) =>
  row(title) ? within(row(title) as HTMLElement).queryByRole("button", { name }) : null;

describe("knowledge-card-ui: a spec in the documents becomes a card that names it (#78)", () => {
  test("only a spec offers to make a card", async () => {
    render(setup().view);
    await listed();
    expect([makeCard("Login screen") !== null, makeCard("Use a queue") !== null]).toEqual([
      true,
      false,
    ]);
  });

  test("the card is made with the spec's title and names the spec, then the panel says so with a way to open it", async () => {
    const { view, sent, went } = setup();
    render(view);
    await listed();
    const button = makeCard("Login screen");
    if (button) await act(async () => fireEvent.click(button));
    const said = await settleMaybe(
      () => screen.queryByText("Card made from the spec: Login screen") !== null,
    );
    const open = screen.queryByRole("button", { name: "Open card" });
    if (open) await act(async () => fireEvent.click(open));
    expect([
      said,
      sent.find(([type]) => type === "card.create")?.[1],
      sent.find(([type]) => type === "card.update")?.[1],
      screen.queryByText("Card made from the spec: Login screen")?.closest("[role='status']") ===
        null,
      went,
    ]).toEqual([
      true,
      { projectId: "p1", title: "Login screen", description: "" },
      { cardId: "c9", specPath: "docs/specs/login.md" },
      false,
      [{ name: "card", host: "h1", projectId: "p1", cardId: "c9" }],
    ]);
  });

  test("a card the host refuses is not named", async () => {
    const { view, sent } = setup({ refuse: true });
    render(view);
    await listed();
    const button = makeCard("Login screen");
    if (button) await act(async () => fireEvent.click(button));
    const created = await settleMaybe(() => sent.some(([type]) => type === "card.create"));
    expect([created, sent.some(([type]) => type === "card.update")]).toEqual([true, false]);
  });

  test("a card the host would not point at the spec is said as made without it, with a way to open it", async () => {
    const { view, went } = setup({ refuseName: true });
    render(view);
    await listed();
    const button = makeCard("Login screen");
    if (button) await act(async () => fireEvent.click(button));
    const said = await settleMaybe(
      () =>
        screen.queryByText(
          "Card made without its spec: Login screen. Open it to set the spec path.",
        ) !== null,
    );
    const open = screen.queryByRole("button", { name: "Open card" });
    if (open) await act(async () => fireEvent.click(open));
    // The card is there either way: a second click would only make another.
    expect([said, went]).toEqual([
      true,
      [{ name: "card", host: "h1", projectId: "p1", cardId: "c9" }],
    ]);
  });

  test("while the card is made the button keeps the focus: it is unavailable, not disabled", async () => {
    let finish: (value: unknown) => void = () => {};
    const { view, store } = setup();
    const answer = store.hostCommand;
    store.hostCommand = (async (host: string, type: string, payload: unknown) =>
      type === "card.create"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : (answer as (...a: unknown[]) => unknown)(host, type, payload)) as never;
    render(view);
    await listed();
    const button = makeCard("Login screen") as HTMLButtonElement;
    expect(button === null).toBe(false);
    button.focus();
    await act(async () => fireEvent.click(button));
    expect([
      button.disabled,
      button.getAttribute("aria-disabled"),
      document.activeElement === button,
    ]).toEqual([false, "true", true]);
    await act(async () => finish({ id: "c9", title: "Login screen" }));
    await settleMaybe(() => screen.queryByText(/Card made/) !== null);
  });

  test("a second click while the first is making the card makes no second card", async () => {
    const { view, sent } = setup();
    render(view);
    await listed();
    const button = makeCard("Login screen");
    if (button) {
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
    }
    await settleMaybe(() => sent.some(([type]) => type === "card.update"));
    expect(sent.filter(([type]) => type === "card.create").length).toBe(1);
  });

  test("in Portuguese too", async () => {
    render(setup({ language: "pt-BR" }).view);
    await listed();
    expect(makeCard("Login screen", "Criar um cartão de Login screen") !== null).toBe(true);
  });
});
