import { expect } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const testingLibrary = await import("@testing-library/react");
const { render } = testingLibrary;
export const { act, cleanup, fireEvent, within } = testingLibrary;
export const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { BoardView } = await import("../../src/features/board/board-view.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

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

export const card = (id: string, column: string, position: number, over: object = {}) => ({
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

export const CARDS = [
  card("A", "backlog", 1),
  card("B", "backlog", 2),
  card("C", "backlog", 3),
  card("D", "in_progress", 1, { sessionStatus: "running", sessionId: "s1", branch: "fd/d" }),
  card("E", "done", 1),
];

export type Call = [string, unknown];

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

export function setup(
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
    /** #1406: changes.get throws, as a dropped link may. */
    throwChanges?: boolean;
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
    if (type === "changes.get" && options.throwChanges) throw new Error("link dropped");
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

export const li = (title: string) => screen.getByLabelText(`Card ${title}`);
export const titleOf = (name: string) => li(name).querySelector<HTMLElement>("[data-card-open]");
export const bar = (name = "Selection") => screen.queryByRole("group", { name });
export const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
export const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
/** Ctrl-click each card in turn: one act per click, so each sees the selection the last one left. */
export const ctrl = async (...titles: string[]) => {
  for (const title of titles) {
    await act(async () => {
      fireEvent.click(li(title), { ctrlKey: true });
    });
  }
};
export const press = (key: string) =>
  act(async () => {
    fireEvent.keyDown(document.activeElement as Element, { key });
  });
export const ready = () => settle(() => screen.queryByLabelText("Card A") !== null);
/** The button, after asserting it is there: a missing one fails as an assertion, not a throw. */
export const button = (box: HTMLElement | null, name: string) => {
  const found = box ? within(box).queryByRole("button", { name }) : null;
  expect(found).not.toBeNull();
  return found as HTMLElement;
};
export const dialog = () => screen.queryByRole("alertdialog");
export const dialogText = () => (dialog()?.textContent ?? "").replace(/\s+/g, " ");
export const started = (requests: Call[], type: string) =>
  requests.filter(([kind]) => kind === type).map(([, p]) => (p as { cardId: string }).cardId);

export const asked = (requests: Call[]) => requests.some(([type]) => type === "resources.get");
/** The focused element's text and the card or bar it sits in: a check of where the focus went. */
export const focusAt = () => {
  const el = document.activeElement as HTMLElement | null;
  return {
    card: el?.closest("li[data-card]")?.getAttribute("data-card") ?? null,
    open: el?.hasAttribute("data-card-open") ?? false,
    text: el?.textContent ?? "",
  };
};
