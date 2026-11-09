import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * #1354 (docs/decisions/2026-11-09-board-bulk-actions.md): Start N and Stop N act on the selection.
 * The bar counts what each can take; Start asks first with the host's queue and quota, Stop asks
 * first and says where the cards land; the host is asked one card at a time.
 */
const host = {
  id: "h1",
  name: "alfa",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
};

const card = (id: string, column: string, position: number, over: object = {}) => ({
  id,
  projectId: "p1",
  title: id,
  description: `about ${id}\n\n- [ ] it works`,
  column,
  position,
  createdAt: `2026-11-04T10:0${position}:00Z`,
  waitingOn: [],
  blocking: [],
  branch: null,
  worktreePath: null,
  sessionId: null,
  sessionStatus: null,
  queued: false,
  ...over,
});

const CARDS = [
  card("A", "backlog", 1),
  card("B", "backlog", 2),
  card("C", "backlog", 3),
  card("D", "in_progress", 1, { sessionStatus: "running", sessionId: "s1", branch: "fd/d" }),
  card("E", "done", 1),
];

type Call = [string, unknown];

/** A ResizeObserver whose callbacks the test fires with the width it wants. */
function fakeResizeObserver() {
  const saved = globalThis.ResizeObserver;
  const observers: Array<(width: number) => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      observers.push((width) =>
        callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver),
      );
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  return {
    resize: (width: number) =>
      act(async () => {
        for (const fire of observers) fire(width);
      }),
    restore: () => {
      globalThis.ResizeObserver = saved;
    },
  };
}

function setup(
  options: { language?: "en" | "pt-BR"; refuse?: string[]; quota?: boolean; max?: number } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  internals.update({ hosts: [host] });
  internals.update({ cards: Object.fromEntries(CARDS.map((c) => [`h1/${c.id}`, c])) });
  if (options.quota) {
    internals.update({
      quota: {
        h1: {
          windows: [
            {
              window: "five_hour",
              utilization: 0.42,
              status: "allowed",
              resetsAt: "2026-11-09T15:00:00Z",
              readAt: new Date().toISOString(),
            },
          ],
          pauseAt: 0.9,
        },
      },
    });
  }
  const commands: Call[] = [];
  const requests: Call[] = [];
  store.hostCommand = (async (_hostId: string, type: string, payload: unknown) => {
    commands.push([type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    if (type === "project.list") return { projects: [], maxParallelRuns: options.max ?? 2 };
    if (type === "workflow.list") return [];
    return {};
  }) as never;
  store.hostRequest = (async (_hostId: string, type: string, payload: unknown) => {
    requests.push([type, payload]);
    const id = (payload as { cardId?: string }).cardId ?? "";
    return options.refuse?.includes(id)
      ? { ok: false, message: "the host refused" }
      : { ok: true, data: {} };
  }) as never;
  const ro = fakeResizeObserver();
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  return { store, commands, requests, ...ro };
}

const li = (title: string) => screen.getByLabelText(`Card ${title}`);
const titleOf = (name: string) => li(name).querySelector<HTMLElement>("[data-card-open]");
const bar = (name = "Selection") => screen.queryByRole("group", { name });
const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
/** Ctrl-click each card in turn: one act per click, so each sees the selection the last one left. */
const ctrl = async (...titles: string[]) => {
  for (const title of titles) {
    await act(async () => {
      fireEvent.click(li(title), { ctrlKey: true });
    });
  }
};
const press = (key: string) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement as Element, { key });
  });
const ready = () => settle(() => screen.queryByLabelText("Card A") !== null);
/** The button, after asserting it is there: a missing one fails as an assertion, not a throw. */
const button = (box: HTMLElement | null, name: string) => {
  const found = box ? within(box).queryByRole("button", { name }) : null;
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
const dialog = () => screen.queryByRole("alertdialog");
const dialogText = () => (dialog()?.textContent ?? "").replace(/\s+/g, " ");
const started = (requests: Call[], type: string) =>
  requests.filter(([kind]) => kind === type).map(([, p]) => (p as { cardId: string }).cardId);

describe("board-bulk-ui: Start N and Stop N in the bar (#1354)", () => {
  test("the bar counts what each takes: Start is the primary, Stop counts the running card", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "C", "D");
    const group = within(bar() as HTMLElement);
    const start = group.queryByRole("button", { name: "Start 2" });
    const stop = group.queryByRole("button", { name: "Stop 1" });
    expect([
      start?.getAttribute("data-variant"),
      stop?.getAttribute("data-variant"),
      start?.hasAttribute("disabled"),
    ]).toEqual(["default", "outline", false]);
    restore();
  });

  test("with nothing to take, the button is off and says why", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("D");
    const group = within(bar() as HTMLElement);
    const start = group.queryByRole("button", { name: "Start 0" });
    const stop = group.queryByRole("button", { name: "Stop 1" });
    const reason = document.getElementById(start?.getAttribute("aria-describedby") ?? "");
    expect([
      start?.hasAttribute("disabled"),
      reason?.textContent,
      stop?.getAttribute("data-variant"),
    ]).toEqual([true, "None of the selected cards can start", "outline"]);
    restore();
  });
});

describe("board-bulk-ui: the Start confirm (#1354)", () => {
  test("s on a selection asks first: the count, the host's queue and quota, and the card it skips", async () => {
    const { restore } = setup({ quota: true });
    await ready();
    await ctrl("A", "C", "D");
    titleOf("A")?.focus();
    await press("s");
    await settleMaybe(() => dialogText().includes("waits"));
    expect([
      screen.queryByRole("heading", { name: "Start 2 cards?" }) !== null,
      dialogText().includes("1 starts now and 1 waits in the board's queue (at most 2 at once)."),
      dialogText().includes("alfa: 42% of the 5-hour window used"),
      dialogText().includes("D — skipped: the card is already running"),
    ]).toEqual([true, true, true, true]);
    restore();
  });

  test("Start asks the host for each card in the board's order; started cards leave the selection", async () => {
    const { requests, restore } = setup();
    await ready();
    await ctrl("C", "A", "D");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Start 2"));
    await settleMaybe(() => started(requests, "card.start").length === 2);
    expect([started(requests, "card.start"), selected(), dialog() === null]).toEqual([
      ["A", "C"],
      ["D"],
      true,
    ]);
    restore();
  });

  test("a card the host refuses stays selected and is named", async () => {
    const { restore } = setup({ refuse: ["C"] });
    await ready();
    await ctrl("A", "C");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Start 2"));
    await settleMaybe(() => selected().length === 1);
    expect([selected(), screen.queryAllByText(/1 card did not start: C/).length > 0]).toEqual([
      ["C"],
      true,
    ]);
    restore();
  });

  test("Cancel starts nothing and keeps the selection", async () => {
    const { requests, restore } = setup();
    await ready();
    await ctrl("A", "B");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Cancel"));
    expect([started(requests, "card.start"), selected()]).toEqual([[], ["A", "B"]]);
    restore();
  });
});

describe("board-bulk-ui: the Stop confirm (#1354)", () => {
  test("Stop asks first, says where the cards land, and stops only the running one", async () => {
    const { requests, restore } = setup();
    await ready();
    await ctrl("A", "D");
    await click(button(bar(), "Stop 1"));
    await settleMaybe(() => dialog() !== null);
    const text = dialogText();
    await click(button(dialog(), "Stop 1"));
    await settleMaybe(() => started(requests, "card.stop").length === 1);
    expect([
      text.includes("Stop 1 card?"),
      text.includes("waits in Needs you"),
      text.includes("A — skipped: not running"),
      started(requests, "card.stop"),
      selected(),
    ]).toEqual([true, true, true, ["D"], ["A"]]);
    restore();
  });
});

describe("board-bulk-ui: a narrow board (#1354)", () => {
  test("at 390 Move to and Discard go under ⋯, Clear is short, and the bar names cards in other columns", async () => {
    const { resize, restore } = setup();
    await ready();
    await resize(358);
    await ctrl("A", "B");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^In progress/ }));
    });
    await ctrl("D");
    const group = within(bar() as HTMLElement);
    expect([
      group.queryByRole("button", { name: "More actions for the selection" }) !== null,
      group.queryByRole("button", { name: "Move to…" }) !== null,
      group.queryByRole("button", { name: "Clear" }) !== null,
      (bar()?.textContent ?? "").includes("2 in other columns"),
    ]).toEqual([true, false, true, true]);
    restore();
  });

  test("pt-BR: Iniciar and Parar, and the confirm in Portuguese", async () => {
    const { restore } = setup({ language: "pt-BR" });
    await ready();
    await ctrl("A", "B");
    // The bar before the dialog opens: an open dialog hides the page from the accessibility tree.
    const stop = bar("Seleção")?.querySelectorAll("button")[1]?.textContent ?? "";
    await click(button(bar("Seleção"), "Iniciar 2"));
    await settleMaybe(() => dialog() !== null);
    expect([screen.queryByRole("heading", { name: "Iniciar 2 cards?" }) !== null, stop]).toEqual([
      true,
      "Parar 0",
    ]);
    restore();
  });
});
