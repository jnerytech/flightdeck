import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
export const { act, cleanup, fireEvent, within } = await import("@testing-library/react");
const { render } = await import("@testing-library/react");
export const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { BoardView } = await import("../../src/features/board/board-view.tsx");

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
export const CARDS = [
  card("A", "backlog", 1),
  card("B", "backlog", 2, { branch: "fd/b", worktreePath: "/wt/b" }),
  card("C", "backlog", 3, { sessionId: "s-c" }),
  card("D", "in_progress", 1),
  card("E", "done", 1),
];

type Refusal = { message: string; reason?: string; params?: Record<string, string | number> };
type Call = [string, string, unknown];

/** `refuse`: cards the host refuses; `gate`: requests wait for `release()` (a batch in flight). */
export function setup(
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
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={() => {}}
      onOpenSettings={() => {}}
    />,
  );
  return { store, mem, commands, requests, release };
}

export const lane = (name: string) => screen.getByRole("region", { name });
export const li = (title: string) => screen.getByLabelText(`Card ${title}`);
export const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
export const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
export const ctrl = (title: string) => click(li(title), { ctrlKey: true });
export const bar = () => screen.getByRole("group", { name: "Selection" });
export const barButton = (name: string) =>
  within(bar()).getByRole("button", { name }) as HTMLButtonElement;
export const ready = () =>
  settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);
export const grid = () => document.querySelector("[data-slot='board-columns']") as HTMLElement;
export const discardAll = async (names: string[]) => {
  for (const name of names) await ctrl(name);
  await click(barButton("Discard…"));
  await click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: /^Discard \d+ cards?$/,
    }),
  );
};
