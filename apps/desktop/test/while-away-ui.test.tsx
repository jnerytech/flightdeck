import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { NeedsYou } = await import("../src/ui/NeedsYou.tsx");

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
  ]),
});

interface Setup {
  away?: object;
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
  store.dismissAway = () => {
    dismissed += 1;
  };
  (store as unknown as { update(patch: object): void }).update({
    hosts: [
      { id: "h1", name: "alfa", status: "online", sessions: [] },
      { id: "h2", name: "beta", status: "online", sessions: [] },
    ],
    cards: { "h1/c1": { id: "c1", projectId: "p1", title: "Cart screen" } },
    away: {
      since: SINCE,
      hosts: [{ hostId: "h1", result: ALFA }],
      unreached: [],
      dismissed: false,
      ...setup.away,
    },
  });
  render(
    <NeedsYou
      store={store}
      state={store.getState()}
      go={(route) => void went.push(route)}
      onOpenRequest={() => {}}
    />,
  );
  return { store, went, dismissed: () => dismissed };
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
      expect(text.includes(part)).toBe(true);
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
    expect(went).toEqual([
      { name: "session", host: "h1", id: "s1" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c1" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c2" },
      { name: "card", host: "h1", projectId: "p1", cardId: "c1" },
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

  test("in Portuguese the summary speaks Portuguese", () => {
    open({ lang: "pt-BR" });
    expect(screen.queryByRole("region", { name: "Enquanto você esteve fora" })).not.toBeNull();
  });
});
