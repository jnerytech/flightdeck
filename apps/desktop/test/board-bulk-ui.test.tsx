import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

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
  options: {
    language?: "en" | "pt-BR";
    refuse?: string[];
    quota?: boolean;
    /** The host's budgets, as `budget.updated` keeps them (#1393). */
    budgets?: object[];
    max?: number;
    /** The host's answers to project.list and workflow.list wait until this resolves. */
    hold?: Promise<void>;
    /** The project's workflows, by name and inputs. */
    workflows?: Array<{ name: string; inputs: string[]; trusted?: boolean; errors?: string[] }>;
    cards?: object[];
    /** workflow.list fails: hostCommand answers null, as it does after raising the banner. */
    noWorkflows?: boolean;
    /** The five-hour window's use, 0.42 by default; 0.9 and over is the host's pause limit. */
    used?: number;
    /**
     * #1414: what resources.get answers on a host that offers memoryPause: its memory, its hold, and
     * whether the hold holds now (absent: an older host that does not say).
     */
    memory?: { totalBytes: number; freeBytes: number; pauseAt: number | null; holding?: boolean };
    /** #1406: how many commits of its base each card lacks, as changes.get says. */
    behind?: Record<string, number>;
    /** #1406: the cards whose update conflicts (the host aborts the rebase). */
    conflict?: string[];
    /** #1406: each card.updateFromBase waits until this resolves. */
    holdUpdate?: Promise<void>;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  const features = options.memory ? ["resources", "memoryPause"] : [];
  internals.update({ hosts: [{ ...host, hostInfo: { daemonVersion: "x", features } }] });
  internals.update({
    cards: Object.fromEntries(
      (options.cards ?? CARDS).map((c) => [`h1/${(c as { id: string }).id}`, c]),
    ),
  });
  if (options.quota) {
    internals.update({
      quota: {
        h1: {
          windows: [
            {
              window: "five_hour",
              utilization: options.used ?? 0.42,
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
  if (options.budgets) internals.update({ budgets: { h1: options.budgets } });
  const commands: Call[] = [];
  const requests: Call[] = [];
  /** The answer to resources.get, once asked: a test waits on it before it says what is missing. */
  const read: { answer: Promise<unknown> } = { answer: Promise.resolve() };
  store.hostCommand = (async (_hostId: string, type: string, payload: unknown) => {
    commands.push([type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    if (type === "project.list" || type === "workflow.list") await options.hold;
    if (type === "project.list") return { projects: [], maxParallelRuns: options.max ?? 2 };
    // The protocol's shape (#1390's review): { workflows }, each with its trust and errors.
    if (type === "workflow.list") {
      if (options.noWorkflows) return null;
      return {
        workflows: (options.workflows ?? []).map((w) => ({
          hash: "h",
          checks: [],
          trusted: true,
          errors: [],
          ...w,
        })),
      };
    }
    return {};
  }) as never;
  store.hostRequest = (async (_hostId: string, type: string, payload: unknown) => {
    requests.push([type, payload]);
    if (type === "resources.get" && options.memory) {
      const { totalBytes, freeBytes, pauseAt, holding } = options.memory;
      const data = { memory: { totalBytes, freeBytes }, memoryPauseAt: pauseAt };
      read.answer = Promise.resolve({
        ok: true,
        data: holding === undefined ? data : { ...data, memoryHolding: holding },
      });
      return read.answer;
    }
    const id = (payload as { cardId?: string }).cardId ?? "";
    if (type === "changes.get") {
      const target = (payload as { target: string }).target.replace(/^card:/, "");
      const behind = options.behind?.[target] ?? 1;
      return { ok: true, data: { files: [], base: "main", position: { ahead: 1, behind } } };
    }
    if (type === "card.updateFromBase") await options.holdUpdate;
    if (type === "card.updateFromBase" && options.conflict?.includes(id)) {
      return {
        ok: false,
        code: "invalid_state",
        message: "conflict updating with main: src/a.ts",
        reason: "rebase_conflict",
        params: { base: "main", files: "src/a.ts" },
      };
    }
    return options.refuse?.includes(id)
      ? { ok: false, message: "the host refused" }
      : { ok: true, data: {} };
  }) as never;
  const ro = fakeResizeObserver();
  // As the app renders it: the card tiles read the language from the context.
  render(
    <TContext.Provider value={store.i18n.t}>
      <BoardView
        store={store}
        hostId="h1"
        projectId="p1"
        onOpenCard={() => {}}
        onOpenSettings={() => {}}
      />
    </TContext.Provider>,
  );
  /** Waits until the confirm has had resources.get's answer, and React has drawn it. */
  const memoryRead = () =>
    act(async () => {
      await read.answer;
      await Promise.resolve();
    });
  return { store, commands, requests, memoryRead, ...ro };
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

  // The narrow guard of the prints: a reason hung under a bar button was drawn over the cards at
  // 1024 and past the window at 390. Start's reason is a line of the bar, in the flow.
  test("with nothing to start, Start is off and says why on a line of the bar", async () => {
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
      reason?.classList.contains("field-help"),
      stop?.getAttribute("data-variant"),
    ]).toEqual([true, "None of the selected cards can start", true, "outline"]);
    restore();
  });

  test("Stop shows only while a selected card is running or queued", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "B");
    const none = within(bar() as HTMLElement).queryByRole("button", { name: /^Stop/ }) === null;
    await ctrl("D");
    expect([
      none,
      within(bar() as HTMLElement).queryByRole("button", { name: "Stop 1" }) !== null,
    ]).toEqual([true, true]);
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

  test("the confirm names a budget hold and a memory hold, one line each, in English and pt-BR (#1393)", async () => {
    const holds = {
      budgets: [{ id: "b", scope: "host", projectKey: null, action: "queue", fraction: 1.1 }],
      cards: [...CARDS, card("Q", "backlog", 4, { queued: true, queueReason: "memory" })],
    };
    const { restore } = setup(holds);
    await ready();
    await ctrl("A", "B");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialogText().includes("budget"));
    const english = dialogText();
    restore();
    cleanup();
    const pt = setup({ ...holds, language: "pt-BR" });
    await ready();
    await ctrl("A", "B");
    await click(button(bar("Seleção"), "Iniciar 2"));
    await settleMaybe(() => dialogText().includes("orçamento"));
    const portuguese = dialogText();
    pt.restore();
    expect([
      english.includes("Start 2 cards?"),
      english.includes("alfa reached a budget that holds new cards"),
      english.includes("alfa is short of memory: new cards wait until it frees up."),
      portuguese.includes("alfa chegou a um orçamento que segura cards novos"),
      portuguese.includes("alfa está sem memória"),
    ]).toEqual([true, true, true, true, true]);
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

// From the ux-reviewer: the card's workflow and the host's limit arrive after the confirm opens.
describe("board-bulk-ui: what the confirm waits for (#1354)", () => {
  test("Start in the confirm is off until the host's limit and the workflows have come", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { restore } = setup({ hold });
    await ready();
    await ctrl("A", "B");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialog() !== null);
    const before = button(dialog(), "Start 2").hasAttribute("disabled");
    await act(async () => {
      release();
    });
    await settleMaybe(() => !button(dialog(), "Start 2").hasAttribute("disabled"));
    expect([before, button(dialog(), "Start 2").hasAttribute("disabled")]).toEqual([true, false]);
    restore();
  });

  // #1390's review: a read that failed is not an empty list; Start waits, and says why.
  test("when the workflows cannot be read, Start stays off and the confirm says so", async () => {
    const { restore } = setup({ noWorkflows: true });
    await ready();
    await ctrl("A", "B");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialogText().includes("could not be read"));
    expect([
      button(dialog(), "Start 2").hasAttribute("disabled"),
      dialogText().includes(
        "The project's workflows could not be read: start the cards from their menus.",
      ),
    ]).toEqual([true, true]);
    restore();
  });

  test("a card whose workflow asks for inputs is skipped, with why, and starts from its menu", async () => {
    const { requests, restore } = setup({
      workflows: [{ name: "deploy", inputs: ["alert"] }],
      cards: [...CARDS, card("W", "backlog", 4, { startWorkflow: "deploy" })],
    });
    await ready();
    await ctrl("A", "W");
    await click(button(bar(), "Start 2"));
    await settleMaybe(() => dialogText().includes("asks for inputs"));
    const text = dialogText();
    await click(button(dialog(), "Start 1"));
    await settleMaybe(() => started(requests, "card.start").length === 1);
    expect([
      text.includes("Start 1 card?"),
      text.includes("W — skipped: its workflow asks for inputs; start it from its menu"),
      started(requests, "card.start"),
    ]).toEqual([true, true, ["A"]]);
    restore();
  });
});

describe("board-bulk-ui: the workflow a card starts with (#1354)", () => {
  // #1390's review: as the start dialog does, only a trusted workflow with no errors is used; a card
  // whose workflow is not trusted, or broken, starts plain, and its own template workflow when it is.
  test("a trusted workflow goes with its card; an untrusted or broken one does not", async () => {
    const { requests, restore } = setup({
      workflows: [
        { name: "review", inputs: [] },
        { name: "shady", inputs: [], trusted: false },
        { name: "broken", inputs: [], errors: ["bad step"] },
      ],
      cards: [
        ...CARDS,
        card("R", "backlog", 4, { startWorkflow: "review" }),
        card("S", "backlog", 5, { startWorkflow: "shady" }),
        card("K", "backlog", 6, { startWorkflow: "broken" }),
      ],
    });
    await ready();
    await ctrl("R", "S", "K");
    await click(button(bar(), "Start 3"));
    await settleMaybe(
      () => dialog() !== null && !button(dialog(), "Start 3").hasAttribute("disabled"),
    );
    await click(button(dialog(), "Start 3"));
    await settleMaybe(() => started(requests, "card.start").length === 3);
    const sent = requests
      .filter(([kind]) => kind === "card.start")
      .map(
        ([, p]) =>
          `${(p as { cardId: string }).cardId}:${(p as { workflow?: string }).workflow ?? "-"}`,
      );
    expect(sent).toEqual(["R:review", "S:-", "K:-"]);
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
    // The bar before the dialog opens hides it: Iniciar, and no Parar with nothing running.
    const labels = [...(bar("Seleção")?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent,
    );
    await click(button(bar("Seleção"), "Iniciar 2"));
    await settleMaybe(() => dialog() !== null);
    expect([
      screen.queryByRole("heading", { name: "Iniciar 2 cards?" }) !== null,
      labels.includes("Iniciar 2"),
      labels.some((label) => label?.startsWith("Parar")),
    ]).toEqual([true, true, false]);
    restore();
  });
});

/** Opens the Start confirm of A and B and waits for the host's limit. */
const openStart = async (language: "en" | "pt-BR" = "en") => {
  await ready();
  await ctrl("A", "B");
  const [group, start] = language === "en" ? ["Selection", "Start 2"] : ["Seleção", "Iniciar 2"];
  await click(button(bar(group), start));
  await settleMaybe(() => /fila|queue|agora|now/.test(dialogText()));
};
const asked = (requests: Call[]) => requests.some(([type]) => type === "resources.get");
/** The queue line says a card starts now: "1 starts now", "All of them start now", "iniciam agora". */
const startsNow = () => /\b(now|agora)\b/.test(dialogText());

// #1414: what #1400 left out. The memory hold is read when the confirm opens, not only from a
// queued card's reason, and with any hold the queue line says they all wait.
describe("board-bulk-ui: the holds agree with the queue line (#1414)", () => {
  test("the host's hold holds with nothing queued yet: the memory line, and they all wait", async () => {
    const memory = { totalBytes: 100, freeBytes: 8, pauseAt: 0.9, holding: true };
    const en = setup({ memory });
    await openStart();
    await en.memoryRead();
    const english = [
      asked(en.requests),
      dialogText().includes("alfa is short of memory: new cards wait until it frees up."),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ];
    en.restore();
    cleanup();
    const pt = setup({ language: "pt-BR", memory });
    await openStart("pt-BR");
    await pt.memoryRead();
    expect([
      ...english,
      dialogText().includes("alfa está sem memória: os cards novos esperam ela liberar."),
      dialogText().includes("Eles entram na fila do board."),
      startsNow(),
    ]).toEqual([true, true, true, false, true, true, false]);
    pt.restore();
  });

  test("a margin under the share, the host still holds: the line follows the host, not the share", async () => {
    const { memoryRead, restore } = setup({
      memory: { totalBytes: 100, freeBytes: 11, pauseAt: 0.9, holding: true },
    });
    await openStart();
    await memoryRead();
    expect([dialogText().includes("alfa is short of memory"), startsNow()]).toEqual([true, false]);
    restore();
  });

  test("over the share but the host does not hold (no reading, as on macOS): no line, the split stands", async () => {
    const { memoryRead, restore } = setup({
      memory: { totalBytes: 100, freeBytes: 3, pauseAt: 0.9, holding: false },
    });
    await openStart();
    await memoryRead();
    expect([dialogText().includes("memory"), startsNow()]).toEqual([false, true]);
    restore();
  });

  test("an older host that does not say, or one without the hold: no memory line", async () => {
    const older = setup({ memory: { totalBytes: 100, freeBytes: 3, pauseAt: 0.9 } });
    await openStart();
    await older.memoryRead();
    const silent = [asked(older.requests), dialogText().includes("memory"), startsNow()];
    older.restore();
    cleanup();
    const none = setup();
    await openStart();
    await none.memoryRead();
    expect([...silent, asked(none.requests), dialogText().includes("memory")]).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
    none.restore();
  });

  test("the quota over its pause limit: the queue line says they all wait, in both languages", async () => {
    const en = setup({ quota: true, used: 0.95 });
    await openStart();
    const english = [
      dialogText().includes("alfa is over its pause limit"),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ];
    en.restore();
    cleanup();
    const pt = setup({ language: "pt-BR", quota: true, used: 0.95 });
    await openStart("pt-BR");
    expect([
      ...english,
      dialogText().includes("alfa passou do limite de pausa"),
      dialogText().includes("Eles entram na fila do board."),
      startsNow(),
    ]).toEqual([true, true, false, true, true, false]);
    pt.restore();
  });

  test("a budget that holds: the queue line says they all wait", async () => {
    const { restore } = setup({
      budgets: [{ id: "b", scope: "host", projectKey: null, action: "queue", fraction: 1 }],
    });
    await openStart();
    expect([
      dialogText().includes("alfa reached a budget that holds new cards"),
      dialogText().includes("They join the board's queue."),
      startsNow(),
    ]).toEqual([true, true, false]);
    restore();
  });
});

/** The focused element's text and the card or bar it sits in: a check of where the focus went. */
const focusAt = () => {
  const el = document.activeElement as HTMLElement | null;
  return {
    card: el?.closest("li[data-card]")?.getAttribute("data-card") ?? null,
    open: el?.hasAttribute("data-card-open") ?? false,
    text: el?.textContent ?? "",
  };
};
const pressEscape = () =>
  act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  });

// #1426 (round 10 of #168): closing a confirm left the focus on the page body, so a keyboard user
// started again from the top. It goes back to where the person was.
describe("board-bulk-ui: the focus after a confirm closes (#1426)", () => {
  test("s on a card, then Esc: the focus is back on that card", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "C");
    titleOf("C")?.focus();
    await press("s");
    await settleMaybe(() => dialog() !== null);
    await pressEscape();
    await settleMaybe(() => dialog() === null && focusAt().card === "C");
    expect([dialog() === null, focusAt().card, focusAt().open]).toEqual([true, "C", true]);
    restore();
  });

  test("the bar's Start N, then Cancel: the focus is back on Start N", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "B");
    const start = button(bar(), "Start 2");
    start.focus();
    await click(start);
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Cancel"));
    await settleMaybe(() => dialog() === null && focusAt().text === "Start 2");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Start 2"]);
    restore();
  });

  test("the bar's Stop N, then Esc: the focus is back on Stop N", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "D");
    const stop = button(bar(), "Stop 1");
    stop.focus();
    await click(stop);
    await settleMaybe(() => dialog() !== null);
    await pressEscape();
    await settleMaybe(() => dialog() === null && focusAt().text === "Stop 1");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Stop 1"]);
    restore();
  });

  test("Discard…, then Cancel: the focus is back on Discard…", async () => {
    const { restore } = setup();
    await ready();
    await ctrl("A", "B");
    const discard = button(bar(), "Discard…");
    discard.focus();
    await click(discard);
    await settleMaybe(() => dialog() !== null);
    await click(button(dialog(), "Cancel"));
    await settleMaybe(() => dialog() === null && focusAt().text === "Discard…");
    expect([dialog() === null, focusAt().text]).toEqual([true, "Discard…"]);
    restore();
  });
});

describe("board-bulk-ui: the conflict radar badge on a card (#1405)", () => {
  test("a card the host says may conflict with another shows it; the others show nothing", async () => {
    const { restore } = setup({
      cards: [
        card("A", "backlog", 1, {
          mayConflict: [{ cardId: "B", title: "B", files: ["src/a.ts"] }],
        }),
        card("B", "backlog", 2),
      ],
    });
    await ready();
    expect([
      li("A").textContent?.includes("May conflict with B"),
      li("B").textContent?.includes("May conflict"),
    ]).toEqual([true, false]);
    restore();
  });
});

// #1406: Update from the base for the selection, after main moved. It takes the idle cards with a
// branch, one after the other, leaves a current card alone, stops only a conflicted card, and the
// summary names each group.
const branched = (id: string, position: number, over: object = {}) =>
  card(id, "review", position, {
    branch: `fd/${id.toLowerCase()}`,
    worktreePath: `/w/${id}`,
    sessionStatus: "idle",
    sessionId: `s-${id}`,
    ...over,
  });
const UPDATABLE = [...CARDS, branched("F", 1), branched("G", 2), branched("H", 3)];
const updated = (requests: Call[]) => started(requests, "card.updateFromBase");
const noticeText = () =>
  screen
    .queryAllByRole("button", { name: /^Dismiss|^Dispensar/ })
    .map((b) => (b.parentElement?.textContent ?? "").replace(/\s+/g, " "))
    .join("");

describe("board-bulk-ui: Update from the base for the selection (#1406)", () => {
  test("the bar counts only the idle cards with a branch, and shows the action only when there is one", async () => {
    const { restore } = setup({ cards: UPDATABLE });
    await ready();
    await ctrl("A", "B");
    const none =
      within(bar() as HTMLElement).queryByRole("button", { name: /from the base/ }) === null;
    await ctrl("D", "F", "G");
    expect([
      none,
      within(bar() as HTMLElement).queryByRole("button", { name: "Update 2 from the base" }) !==
        null,
    ]).toEqual([true, true]);
    restore();
  });

  test("it runs card by card with its progress on the bar, then sums up; a conflicted card stays selected", async () => {
    let release = () => {};
    const holdUpdate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { requests, restore } = setup({
      cards: UPDATABLE,
      behind: { F: 2, G: 0, H: 1 },
      conflict: ["H"],
      holdUpdate,
    });
    await ready();
    await ctrl("F", "G", "H");
    const update = button(bar(), "Update 3 from the base");
    update.focus();
    await click(update);
    await settleMaybe(() => (bar()?.textContent ?? "").includes("Updating 0 of 3…"));
    const during = {
      progress: (bar()?.textContent ?? "").includes("Updating 0 of 3…"),
      off: update.hasAttribute("disabled"),
    };
    await act(async () => {
      release();
    });
    await settleMaybe(() => noticeText().includes("Updated:"));
    expect({
      during,
      // G is on its base already: it is not rebased.
      asked: updated(requests),
      notice: noticeText(),
      selected: selected(),
      focus: focusAt().text,
    }).toEqual({
      during: { progress: true, off: true },
      asked: ["F", "H"],
      notice:
        "Updated: F. Already current: G. Conflict, left as it was: H (Updating with main conflicts in: src/a.ts). Dismiss",
      selected: ["H"],
      focus: "Update 1 from the base",
    });
    restore();
  });

  test("a card the host refuses is named as not updated, with why", async () => {
    const { restore } = setup({ cards: UPDATABLE, refuse: ["G"] });
    await ready();
    await ctrl("F", "G");
    await click(button(bar(), "Update 2 from the base"));
    await settleMaybe(() => noticeText().includes("Not updated"));
    expect([noticeText(), selected()]).toEqual([
      "Updated: F. Not updated: G (the host refused). Dismiss",
      ["G"],
    ]);
    restore();
  });

  test("at 390 the action is under ⋯ with Move to and Discard", async () => {
    const { requests, resize, restore } = setup({ cards: UPDATABLE });
    await ready();
    await resize(358);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^In review/ }));
    });
    await ctrl("F", "G");
    const more = button(bar(), "More actions for the selection");
    await act(async () => {
      fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const item = screen.queryByRole("menuitem", { name: "Update 2 from the base" });
    expect(item).not.toBeNull();
    await click(item as HTMLElement);
    await settleMaybe(() => noticeText().includes("Updated:"));
    expect([
      within(bar() as HTMLElement).queryByRole("button", { name: /from the base/ }),
      updated(requests),
    ]).toEqual([null, ["F", "G"]]);
    restore();
  });

  test("pt-BR: Atualizar com a base, and the summary in Portuguese", async () => {
    const { restore } = setup({ language: "pt-BR", cards: UPDATABLE, behind: { G: 0 } });
    await ready();
    await ctrl("F", "G");
    await click(button(bar("Seleção"), "Atualizar 2 com a base"));
    await settleMaybe(() => noticeText().includes("Atualizados"));
    expect(noticeText()).toBe("Atualizados: F. Já em dia: G. Dispensar");
    restore();
  });
});
