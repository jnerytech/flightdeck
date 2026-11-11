import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { NeedsYou } = await import("../src/features/needs-you/page.tsx");

afterEach(() => cleanup());

const NOW = Date.parse("2026-11-09T08:00:00.000Z");
const SINCE = "2026-11-09T00:00:00.000Z";
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const list = <T,>(items: T[], total = items.length) => ({ items, total });
const result = (over: object = {}) => ({
  since: SINCE,
  sessions: list([]),
  reviewCards: list([]),
  prs: list([]),
  failedRuns: list([]),
  quota: [{ window: "five_hour", utilization: 0.4 }],
  ...over,
});

const ALFA = result({
  sessions: list([{ id: "s1", name: "Fix login", cwd: "/work/web", at: at(2) }], 4),
  reviewCards: list([{ cardId: "c1", projectId: "p1", title: "Cart screen", at: at(3) }]),
  prs: list([
    {
      cardId: "c2",
      projectId: "p1",
      title: "Pay button",
      at: at(1),
      prUrl: "https://x/1",
      outcome: "merged",
    },
    {
      cardId: "c3",
      projectId: "p1",
      title: "Tax rules",
      at: at(1),
      prUrl: "https://x/2",
      outcome: "checks-failed",
    },
  ]),
  failedRuns: list([
    {
      runId: "r1",
      cardId: "c1",
      workflowName: "ship",
      reasonKey: null,
      reasonParams: null,
      at: at(4),
    },
    {
      runId: "r9",
      cardId: "c9",
      projectId: "p9",
      workflowName: "deploy",
      reasonKey: null,
      reasonParams: null,
      at: at(3),
    },
  ]),
});

interface Setup {
  /** Something that finished, so the list has a row with the cursor on it. */
  finished?: boolean;
  away?: object;
  /** Dismiss really marks the summary dismissed, so the page can be rendered again without it. */
  realDismiss?: boolean;
  lang?: "en" | "pt-BR";
}

/** Needs you, with nothing waiting, and the summary `away` says; `went` collects where the links go. */
function open(setup: Setup = {}) {
  const store = new AppStore(memoryPlatform(false, setup.lang ?? "en").platform, {
    now: () => NOW,
  });
  store.i18n.start();
  const went: object[] = [];
  let dismissed = 0;
  store.activity.dismissAway = () => {
    dismissed += 1;
    if (setup.realDismiss) {
      const away = store.getState().away;
      (store as unknown as { update(patch: object): void }).update({
        away: { ...away, dismissed: true },
      });
    }
  };
  (store as unknown as { update(patch: object): void }).update({
    hosts: [
      { id: "h1", name: "alfa", status: "online", sessions: [] },
      { id: "h2", name: "beta", status: "online", sessions: [] },
    ],
    cards: { "h1/c1": { id: "c1", projectId: "p1", title: "Cart screen" } },
    ...(setup.finished
      ? {
          finishedLook: null,
          finished: [
            {
              key: "h1/f1",
              hostId: "h1",
              sessionId: "f1",
              name: "Docs rewrite",
              outcome: "done",
              at: at(1),
              files: 2,
            },
          ],
        }
      : {}),
    away: {
      since: SINCE,
      hosts: [{ hostId: "h1", result: ALFA }],
      unreached: [],
      dismissed: false,
      ...setup.away,
    },
  });
  const page = () => (
    <NeedsYou
      store={store}
      state={store.getState()}
      go={(route) => void went.push(route)}
      onOpenRequest={() => {}}
    />
  );
  const view = render(page());
  /** The page again with the store's state now, as the screen does when the store changes. */
  const again = () => act(async () => view.rerender(page()));
  return { store, went, dismissed: () => dismissed, again };
}

const panel = () => screen.queryByRole("region", { name: "While you were away" });
const inPanel = () => within(panel() ?? document.createElement("div"));
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    if (el) fireEvent.click(el);
  });
};

describe("while-away-ui: the summary at the top of Needs you (#1344)", () => {
  test("shows per host what happened, even when nothing waits for the person", () => {
    open();
    expect(panel()).not.toBeNull();
    const text = panel()?.textContent ?? "";
    for (const part of [
      "alfa",
      "Sessions finished",
      "Fix login",
      "Cards in review",
      "Cart screen",
      "Pay button: merged",
      "Tax rules: checks failing",
      "Failed runs",
      "ship",
      "5 hours 40%",
    ]) {
      expect(text).toContain(part);
    }
    // The page still says nothing waits, below the summary.
    expect(document.body.textContent).toContain("Nothing is waiting for you.");
  });

  test("says how many more there are than the lines it shows", () => {
    open();
    expect(panel()?.textContent ?? "").toContain("and 3 more");
  });

  test("each line goes to what it names: the session, the card, the card of the run", async () => {
    const { went } = open();
    await click(inPanel().queryByRole("button", { name: /Fix login/ }));
    await click(inPanel().queryByRole("button", { name: /^Cart screen$/ }));
    await click(inPanel().queryByRole("button", { name: /Pay button: merged/ }));
    await click(inPanel().queryByRole("button", { name: /ship/ }));
    // A run of a card the app has not loaded opens it by the project the run carries (#1408).
    await click(inPanel().queryByRole("button", { name: /deploy/ }));
    expect(went).toEqual([
      { name: "session", host: "h1", id: "s1" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c1" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c2" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c1" },
      { name: "card", host: "h1", projectId: "p9", cardId: "c9" },
    ]);
  });

  test("a host that did not answer is named", () => {
    open({ away: { unreached: ["h2"] } });
    expect(panel()?.textContent ?? "").toContain("beta did not answer");
  });

  test("no summary with nothing new, and none once it is closed", () => {
    open();
    expect(panel()).not.toBeNull();
    cleanup();
    open({ away: { hosts: [{ hostId: "h1", result: result() }] } });
    expect(panel()).toBeNull();
    cleanup();
    open({ away: { dismissed: true } });
    expect(panel()).toBeNull();
  });

  test("Dismiss asks the store to close it", async () => {
    const { dismissed } = open();
    await click(inPanel().queryByRole("button", { name: "Dismiss" }));
    expect(dismissed()).toBe(1);
  });

  test("Dismiss moves the focus to the first item of the list, which says what it is", async () => {
    const { again } = open({ finished: true, realDismiss: true });
    const dismiss = inPanel().queryByRole("button", { name: "Dismiss" });
    dismiss?.focus();
    const before = document.activeElement === dismiss;
    await click(dismiss);
    await again();
    const row = screen.queryByRole("button", { name: /Docs rewrite/ });
    expect([before, panel() === null, row !== null && document.activeElement === row]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("with nothing in the list, Dismiss moves the focus to the Needs you heading", async () => {
    const { again } = open({ realDismiss: true });
    const dismiss = inPanel().queryByRole("button", { name: "Dismiss" });
    dismiss?.focus();
    const before = document.activeElement === dismiss;
    await click(dismiss);
    await again();
    const heading = screen.queryByRole("heading", { name: "Needs you", level: 1 });
    expect([
      before,
      panel() === null,
      heading !== null && document.activeElement === heading,
    ]).toEqual([true, true, true]);
  });

  test("Enter on a button of the summary does not also open the row under the list's cursor", async () => {
    open({ finished: true });
    // The list is there, with its row.
    expect(screen.queryByRole("button", { name: /Docs rewrite/ })).not.toBeNull();
    const dismiss = inPanel().queryByRole("button", { name: "Dismiss" });
    expect(dismiss).not.toBeNull();
    const press = async (target: Element | null, key: string) => {
      await act(async () => {
        if (target) fireEvent.keyDown(target, { key, bubbles: true });
      });
    };
    const detailOpen = () => screen.queryByRole("button", { name: "See the changes" }) !== null;
    // J on the summary does not move the list's cursor: Enter elsewhere then has no row to open.
    await press(dismiss, "j");
    await press(document.body, "Enter");
    expect(detailOpen()).toBe(false);
    // With the cursor on the row, Enter on the summary does not open it.
    await press(document.body, "j");
    await press(dismiss, "Enter");
    expect(detailOpen()).toBe(false);
    // Control: the same Enter anywhere else on the page opens the row under the cursor.
    await press(document.body, "Enter");
    expect(detailOpen()).toBe(true);
  });

  test("in Portuguese the summary speaks Portuguese", () => {
    open({ lang: "pt-BR" });
    expect(screen.queryByRole("region", { name: "Enquanto você esteve fora" })).not.toBeNull();
  });
});
