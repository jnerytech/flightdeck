import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

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
  description: `about ${id}`,
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
  card("B", "backlog", 2, { branch: "fd/b", worktreePath: "/wt/b" }),
  card("C", "backlog", 3, { sessionId: "s-c" }),
  card("D", "in_progress", 1),
  card("E", "done", 1),
];

type Refusal = { message: string; reason?: string; params?: Record<string, string | number> };
type Call = [string, string, unknown];

/** `refuse`: cards the host refuses; `gate`: requests wait for `release()` (a batch in flight). */
function setup(
  options: {
    cards?: object[];
    language?: "en" | "pt-BR";
    refuse?: Record<string, Refusal>;
    gate?: boolean;
  } = {},
) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  internals.update({ hosts: [host] });
  internals.update({
    cards: Object.fromEntries(
      (options.cards ?? CARDS).map((c) => [`h1/${(c as { id: string }).id}`, c]),
    ),
  });
  const commands: Call[] = [];
  const requests: Call[] = [];
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    if (type === "card.create") return { id: "new1", ...(payload as object) };
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    requests.push([hostId, type, payload]);
    if (options.gate) await opened;
    const id = (payload as { cardId?: string }).cardId ?? "";
    const refusal = options.refuse?.[id];
    return refusal ? { ok: false, ...refusal } : { ok: true, data: {} };
  }) as never;
  render(<BoardView store={store} hostId="h1" projectId="p1" onOpenCard={() => {}} />);
  return { store, mem, commands, requests, release };
}

const li = (title: string) => screen.getByLabelText(`Card ${title}`);
const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
const ctrl = (title: string) => click(li(title), { ctrlKey: true });
const bar = () => screen.getByRole("group", { name: "Selection" });
const barButton = (name: string) =>
  within(bar()).getByRole("button", { name }) as HTMLButtonElement;
const ready = () => settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);
const grid = () => document.querySelector("[data-slot='board-grid']") as HTMLElement;
const discardAll = async (names: string[]) => {
  for (const name of names) await ctrl(name);
  await click(barButton("Discard…"));
  await click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: /^Discard \d+ cards?$/,
    }),
  );
};

describe("board-multi-review: a discard that fails says so (OpenCode review of #161)", () => {
  test("one refusal: its own words, the card is not left selected, the others went", async () => {
    const w = setup({ refuse: { B: { message: "branch -D failed" } } });
    await ready();
    await discardAll(["A", "B"]);
    await settle(() => w.requests.length === 2);
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(
      "1 card could not be discarded and may be partly cleaned up: B (branch -D failed)",
    );
    expect(notice.textContent).not.toContain("stayed where");
    await settle(() => selected().length === 0);
  });

  test("two refusals: the plural, every card named", async () => {
    const w = setup({ refuse: { A: { message: "no" }, B: { message: "nope" } } });
    await ready();
    await discardAll(["A", "B"]);
    await settle(() => w.requests.length === 2);
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain(
      "2 cards could not be discarded and may be partly cleaned up: A (no), B (nope)",
    );
  });

  test("the host's reason is said in the app's language", async () => {
    const w = setup({
      language: "pt-BR",
      refuse: {
        A: { message: "too soon", reason: "account_refresh_too_soon", params: { waitSeconds: 5 } },
      },
    });
    await settle(() => grid() !== null);
    await click(screen.getByLabelText("Card A"), { ctrlKey: true });
    const group = screen.getByRole("group", { name: "Seleção" });
    await act(async () => {
      fireEvent.pointerDown(within(group).getByRole("button", { name: "Mover para…" }), {
        button: 0,
        ctrlKey: false,
        pointerType: "mouse",
      });
    });
    await click(await screen.findByRole("menuitem", { name: "Concluído" }));
    await settle(() => w.requests.length === 1);
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("A conta foi lida há pouco: tente de novo em 5 s.");
    expect(notice.textContent).not.toContain("too soon");
  });
});

describe("board-multi-review: Cancel really cancels (positive control)", () => {
  test("cancelling sends no request at all; confirming the same dialog does", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    await ctrl("C");
    await click(barButton("Discard…"));
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(w.requests).toEqual([]);
    expect(w.commands.filter(([, type]) => /discard|delete/.test(type))).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(selected()).toEqual(["A", "C"]);
    await click(barButton("Discard…"));
    await click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard 2 cards",
      }),
    );
    await settle(() => w.requests.length === 2);
  });
});

describe("board-multi-review: the dialog tells what is lost (OpenCode review of #161)", () => {
  test("a card with a worktree or branch loses uncommitted work; a session-only one just closes it", async () => {
    setup();
    await ready();
    await ctrl("A");
    await ctrl("B");
    await ctrl("C");
    await click(barButton("Discard…"));
    const dialog = await screen.findByRole("alertdialog");
    const items = within(dialog)
      .getAllByRole("listitem")
      .map((i) => i.textContent ?? "");
    expect(items[0]).toBe("A");
    expect(items[1]).toBe(
      "B — its worktree and branch go with it; uncommitted changes and unpushed commits are lost",
    );
    expect(items[2]).toBe("C — its session is closed");
    expect(within(dialog).getByText("2 of these cards have work started.")).toBeTruthy();
  });
});

describe("board-multi-review: Esc clears the selection only from where it belongs", () => {
  test("Esc in an open card menu closes the menu and keeps the selection", async () => {
    setup();
    await ready();
    await ctrl("A");
    const trigger = within(li("B")).getByRole("button", { name: "Actions for B" });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(trigger);
    });
    const item = (await screen.findAllByRole("menuitem", { name: /Move to/ }))[0] as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(item, { key: "Escape" });
    });
    expect(selected()).toEqual(["A"]);
  });

  test("Esc on the selection bar clears the selection", async () => {
    setup();
    await ready();
    await ctrl("A");
    await act(async () => {
      fireEvent.keyDown(barButton("Clear selection"), { key: "Escape" });
    });
    expect(selected()).toEqual([]);
  });
});

describe("board-multi-review: focus never falls to the page (OpenCode review of #161)", () => {
  test("after Clear selection, Esc and a finished discard the focus is on the board", async () => {
    const w = setup();
    await ready();
    await ctrl("A");
    barButton("Clear selection").focus();
    await click(barButton("Clear selection"));
    expect(document.activeElement).toBe(grid());
    await ctrl("A");
    await act(async () => {
      fireEvent.keyDown(li("A"), { key: "Escape" });
    });
    expect(document.activeElement).toBe(grid());
    await discardAll(["A"]);
    await settle(() => w.requests.length === 1);
    await settle(() => document.activeElement === grid());
  });
});

describe("board-multi-review: a batch in flight cannot be started twice", () => {
  test("while it runs the bar, the cards and a second dialog are off", async () => {
    const w = setup({ gate: true });
    await ready();
    await discardAll(["A", "C"]);
    await settle(() => w.requests.length === 1);
    expect(barButton("Discard…").disabled).toBe(true);
    expect(barButton("Move to…").disabled).toBe(true);
    expect(li("A").getAttribute("draggable")).not.toBe("true");
    await click(barButton("Discard…"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    w.release();
    await settle(() => w.requests.length === 2);
    await settle(() => selected().length === 0);
    expect(w.requests).toHaveLength(2);
  });
});
