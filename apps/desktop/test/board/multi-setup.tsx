import { expect } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, fireEvent, render, within } = await import("@testing-library/react");

export { act, fireEvent, render, within };
export const screen = liveScreen(within);
export const { AppStore } = await import("../../src/lib/app-store.ts");
export const { BoardView } = await import("../../src/features/board/board-view.tsx");

export const host = {
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
  card("C", "backlog", 3),
  card("D", "in_progress", 1),
  card("E", "done", 1),
];

type Call = [string, string, unknown];

export function setup(
  options: { cards?: object[]; language?: "en" | "pt-BR"; refuse?: string[] } = {},
) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  const put = (list: object[]) =>
    internals.update({
      cards: Object.fromEntries(list.map((c) => [`h1/${(c as { id: string }).id}`, c])),
    });
  internals.update({ hosts: [host] });
  put(options.cards ?? CARDS);
  const commands: Call[] = [];
  const requests: Call[] = [];
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    commands.push([hostId, type, payload]);
    if (type === "board.get") return { project: { id: "p1", name: "api" }, cards: [] };
    if (type === "card.create") return { id: "new1", ...(payload as object) };
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    requests.push([hostId, type, payload]);
    const id = (payload as { cardId?: string }).cardId ?? "";
    return options.refuse?.includes(id)
      ? { ok: false, message: "the host refused" }
      : { ok: true, data: {} };
  }) as never;
  const opened: string[] = [];
  render(
    <BoardView
      store={store}
      hostId="h1"
      projectId="p1"
      onOpenCard={(id) => void opened.push(id)}
      onOpenSettings={() => {}}
    />,
  );
  return { store, mem, commands, requests, opened, put };
}

export const li = (title: string) => screen.getByLabelText(`Card ${title}`);
export const lane = (name: string) => screen.getByRole("region", { name });
export const selected = () =>
  [...document.querySelectorAll("li[data-selected='true']")].map((el) =>
    (el.getAttribute("aria-label") ?? "").replace(/^Card /, ""),
  );
export const click = (el: Element, init: object = {}) =>
  act(async () => {
    fireEvent.click(el, init);
  });
export const ctrl = (title: string) => click(li(title), { ctrlKey: true });
export const bar = () => screen.queryByRole("group", { name: "Selection" });
/** The element, after asserting it is there: a missing one fails here, not as a null deeper in. */
export const present = (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  return el as HTMLElement;
};
export const barButton = (name: string) =>
  within(present(bar())).getByRole("button", { name }) as HTMLElement;
export const ready = () =>
  settle(() => screen.queryByRole("heading", { name: "Board of api" }) !== null);
