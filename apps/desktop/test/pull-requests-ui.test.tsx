import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { PullRequestsPage } = await import("../src/ui/PullRequestsPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const card = (id: string, over: object = {}) =>
  ({
    id,
    projectId: "p1",
    title: `Card ${id}`,
    prUrl: `https://x/pr/${id}`,
    prState: "open",
    checksState: "passing",
    worktreePath: `/w/${id}`,
    ...over,
  }) as never;

const host = (id: string, name: string, features: string[], status = "online") => ({
  id,
  name,
  status,
  sessions: [],
  hostInfo: { features },
});

interface Setup {
  cards?: Record<string, unknown>;
  watches?: Record<string, unknown>;
  features?: string[];
  offline?: boolean;
  reply?: { ok: boolean; code?: string; message?: string };
}

function open(setup: Setup = {}) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const asked: Array<[string, string, unknown]> = [];
  const opened: string[] = [];
  const went: object[] = [];
  // The boards are read through the host connections, which a test does not have: the cards are seeded.
  store.loadPalette = (async () => {}) as never;
  store.hostCommand = (async () => null) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    asked.push([hostId, type, payload]);
    return setup.reply ?? { ok: true, data: {} };
  }) as never;
  store.openLink = (url: string) => void opened.push(url);
  const features = setup.features ?? ["cardPrMerge", "watch"];
  (store as unknown as { update(patch: object): void }).update({
    hosts: [
      host("h1", "alpha", features, setup.offline ? "offline" : "online"),
      host("h2", "beta", features, setup.offline ? "offline" : "online"),
    ],
    projects: { h1: [{ id: "p1", name: "api" }], h2: [{ id: "p1", name: "web" }] },
    cards: setup.cards ?? {
      "h1/a": card("a", { checksState: "failing" }),
      "h2/b": card("b"),
    },
    watches: setup.watches ?? {},
  });
  render(
    <TContext.Provider value={store.i18n.t}>
      <PullRequestsPage store={store} go={(route) => void went.push(route)} />
    </TContext.Provider>,
  );
  return { store, asked, opened, went };
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-slot='pr-row']")];
/** A row by its card's title, or an empty element so a missing row fails an assertion. */
const row = (title: string): HTMLElement =>
  rows().find((el) => el.textContent?.includes(title)) ?? document.createElement("div");
const inRow = (title: string) => within(row(title));
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    if (el) fireEvent.click(el);
  });
};

describe("pull-requests-ui: every open PR across hosts (#1345)", () => {
  test("lists the open PRs of both hosts, the failing one first, with host, project and checks", () => {
    open();
    expect(rows().map((el) => el.querySelector("h2")?.textContent)).toEqual(["Card a", "Card b"]);
    expect(row("Card a").textContent).toContain("alpha");
    expect(row("Card a").textContent).toContain("api");
    expect(row("Card a").textContent).toContain("checks failing");
    expect(row("Card b").textContent).toContain("beta");
    expect(row("Card b").textContent).toContain("checks passing");
  });

  test("with no host online it says that, not that nothing is open", async () => {
    open({ offline: true });
    await settle(() => screen.queryByText("No host is online.") !== null);
    expect(screen.queryByText("No host is online.")).not.toBeNull();
    expect(screen.queryByText("No open pull requests.")).toBeNull();
  });

  test("with nothing open it says so", async () => {
    open({ cards: {} });
    await settle(() => screen.queryByText("No open pull requests.") !== null);
    expect(screen.queryByText("No open pull requests.")).not.toBeNull();
  });

  test("a row shows the watch: off, watching, or needing you with the reason", () => {
    open({
      cards: { "h1/a": card("a"), "h1/b": card("b"), "h2/c": card("c"), "h2/d": card("d") },
      watches: {
        "h1/a": { cardId: "a", enabled: false, status: "watching", reason: null, rounds: [] },
        "h1/b": { cardId: "b", enabled: true, status: "watching", reason: null, rounds: [] },
        "h2/c": {
          cardId: "c",
          enabled: true,
          status: "needs_you",
          reason: "the checks kept failing",
          rounds: [],
        },
      },
    });
    expect(row("Card a").textContent).toContain("Watch and fix is off");
    expect(row("Card b").textContent).toContain("Watching the PR");
    expect(row("Card c").textContent).toContain("Needs you: the checks kept failing");
    // Not read yet (or not readable): the row claims nothing, rather than "off".
    // row() gives an empty box for a missing row: the row must be there for "not" to mean anything.
    expect(row("Card d").textContent).toContain("Card d");
    expect(row("Card d").textContent).not.toContain("Watch and fix");
    expect(row("Card d").textContent).not.toContain("Watching");
  });

  test("the title opens the card, and the PR link goes through the app", async () => {
    const { went, opened } = open();
    await click(inRow("Card b").queryByRole("button", { name: "Card b" }));
    expect(went).toEqual([{ name: "card", host: "h2", projectId: "p1", cardId: "b" }]);
    await click(inRow("Card b").queryByRole("link", { name: "Open the PR" }));
    expect(opened).toEqual(["https://x/pr/b"]);
  });

  test("Merge PR asks first, then merges the card on its own host", async () => {
    const { asked } = open();
    await click(inRow("Card b").queryByRole("button", { name: "Merge PR" }));
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog).not.toBeNull();
    expect(asked).toEqual([]);
    await click(within(dialog ?? document.body).queryByRole("button", { name: "Merge PR" }));
    await settle(() => screen.queryByText("The PR was merged.") !== null);
    expect(asked).toEqual([
      ["h2", "card.pr.merge", { cardId: "b", method: "merge", confirm: true }],
    ]);
  });

  test("a refused merge says why, in an alert", async () => {
    open({ reply: { ok: false, code: "pr_refused_x", message: "The base moved, update first." } });
    await click(inRow("Card b").queryByRole("button", { name: "Merge PR" }));
    await click(
      within(screen.queryByRole("alertdialog") ?? document.body).queryByRole("button", {
        name: "Merge PR",
      }),
    );
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByRole("alert")?.textContent).toContain("The base moved, update first.");
  });

  test("a PR with failing checks, or on a host that cannot merge, has no Merge PR button", () => {
    open();
    expect(row("Card a").textContent).toContain("Card a");
    expect(inRow("Card b").queryByRole("button", { name: "Merge PR" })).not.toBeNull();
    expect(inRow("Card a").queryByRole("button", { name: "Merge PR" })).toBeNull();
    cleanup();
    open({ features: ["watch"] });
    expect(inRow("Card b").queryByRole("button", { name: "Update from the base" })).not.toBeNull();
    expect(inRow("Card b").queryByRole("button", { name: "Merge PR" })).toBeNull();
  });

  test("Update from the base rebases the card's branch on its host; a conflict stays on screen", async () => {
    const { asked } = open({
      reply: { ok: false, code: "pr_refused_x", message: "Conflict in src/cart.ts" },
    });
    await click(inRow("Card a").queryByRole("button", { name: "Update from the base" }));
    await settle(() => screen.queryByRole("alert") !== null);
    expect(asked).toEqual([["h1", "card.updateFromBase", { cardId: "a" }]]);
    const alert = screen.queryByRole("alert");
    expect(alert?.textContent).toContain("Conflict in src/cart.ts");
    // It names the card it is about, and takes the focus, as the merge refusal does.
    expect(alert?.textContent).toContain("Card a");
    await settle(() => document.activeElement === screen.queryByRole("alert"));
    expect(document.activeElement === screen.queryByRole("alert")).toBe(true);
  });

  test("the controls of a row point at the card's title, so a list of buttons says which PR", () => {
    open();
    const title = row("Card b").querySelector("h2");
    expect(title?.id).toBeTruthy();
    for (const name of ["Merge PR", "Update from the base"]) {
      const control = inRow("Card b").queryByRole("button", { name });
      expect(control?.getAttribute("aria-describedby") === title?.id).toBe(true);
    }
    const link = inRow("Card b").queryByRole("link", { name: "Open the PR" });
    expect(link?.getAttribute("aria-describedby") === title?.id).toBe(true);
  });
});
