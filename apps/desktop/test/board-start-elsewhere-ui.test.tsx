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

/**
 * #1422 (docs/decisions/2026-11-09-start-elsewhere.md): when the Start N confirm would queue cards
 * (the host is full or paused), it offers "Start on <host>" for another host with the same project
 * and the places. Pressing it makes and starts the cards there, then marks the source cards and
 * moves them to Done. Nothing moves until the person presses it.
 */
const KEY = "git:acme/app";
const hostOf = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
  ...over,
});
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
const running = (id: string) =>
  card(id, "in_progress", 1, { sessionStatus: "running", sessionId: id });

type Call = [string, string, unknown];

function setup(
  options: {
    language?: "en" | "pt-BR";
    /** The other host's project key; the same repository by default. */
    otherKey?: string;
    sourcePaused?: boolean;
    sourceMax?: number;
    otherMax?: number;
  } = {},
) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const internals = store as unknown as { update(p: object): void };
  const pause = options.sourcePaused ? { paused: true, running: 0 } : undefined;
  internals.update({
    hosts: [
      hostOf("h1", "alfa", {
        hostInfo: { daemonVersion: "x", features: [], ...(pause ? { pause } : {}) },
      }),
      hostOf("h2", "beta"),
    ],
  });
  const cards = [card("A", "backlog", 1), card("B", "backlog", 2), running("R")];
  internals.update({ cards: Object.fromEntries(cards.map((c) => [`h1/${c.id}`, c])) });
  const calls: Call[] = [];
  const project = (id: string, key: string) => ({
    id,
    name: "api",
    path: `/${id}`,
    projectKey: key,
  });
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    calls.push([hostId, type, payload]);
    if (type === "board.get") {
      return {
        project: project(
          hostId === "h1" ? "p1" : "p2",
          hostId === "h1" ? KEY : (options.otherKey ?? KEY),
        ),
        cards: [],
      };
    }
    if (type === "project.list") {
      const own = hostId === "h1" ? project("p1", KEY) : project("p2", options.otherKey ?? KEY);
      const max = hostId === "h1" ? (options.sourceMax ?? 1) : (options.otherMax ?? 3);
      return { projects: [own], maxParallelRuns: max };
    }
    if (type === "workflow.list") return { workflows: [] };
    return {};
  }) as never;
  store.hostRequest = (async (hostId: string, type: string, payload: unknown) => {
    calls.push([hostId, type, payload]);
    return {
      ok: true,
      data: type === "card.create" ? { id: `n-${(payload as { title: string }).title}` } : {},
    };
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
  return { store, calls };
}

const li = (title: string) => screen.getByLabelText(`Card ${title}`);
const act1 = (fn: () => void) => act(async () => fn());
const ready = () => settle(() => screen.queryByLabelText("Card A") !== null);
const pickBoth = async () => {
  for (const title of ["A", "B"]) await act1(() => fireEvent.click(li(title), { ctrlKey: true }));
  const startBar = screen.queryByRole("group", { name: "Selection" });
  const start = startBar ? within(startBar).queryByRole("button", { name: "Start 2" }) : null;
  expect(start).not.toBeNull();
  await act1(() => fireEvent.click(start as HTMLElement));
  await settle(() => screen.queryByRole("alertdialog") !== null);
};
const dialog = () => screen.queryByRole("alertdialog") as HTMLElement;
const elsewhere = (name: string) => within(dialog()).queryByRole("button", { name });
const types = (calls: Call[]) =>
  calls.map(([host, type]) => `${host} ${type}`).filter((c) => /card\./.test(c));

describe("board-start-elsewhere-ui: Start on <host> in the Start N confirm (#1422)", () => {
  test("a full host offers the other host with the same project, and pressing it hands the cards over", async () => {
    const { calls } = setup();
    await ready();
    await pickBoth();
    await settle(() => elsewhere("Start on beta") !== null);
    expect(elsewhere("Start on beta")).not.toBeNull();
    // Nothing moved before the person pressed it.
    expect(types(calls)).toEqual([]);
    await act1(() => fireEvent.click(elsewhere("Start on beta") as HTMLElement));
    await settle(() => types(calls).length >= 8);
    expect(types(calls)).toEqual([
      "h2 card.create",
      "h2 card.start",
      "h1 card.update",
      "h1 card.move",
      "h2 card.create",
      "h2 card.start",
      "h1 card.update",
      "h1 card.move",
    ]);
    const create = calls.find(([, type]) => type === "card.create");
    expect(create?.[2]).toEqual({ projectId: "p2", title: "A", description: "about A" });
    await settle(() => screen.queryByRole("alertdialog") === null);
    const said = (document.body.textContent ?? "").includes("2 cards started on beta");
    expect(said).toBe(true);
  });

  test("a paused host makes every card wait and offers the other host too", async () => {
    setup({ sourcePaused: true, sourceMax: 5 });
    await ready();
    await pickBoth();
    await settle(() => elsewhere("Start on beta") !== null);
    expect(elsewhere("Start on beta")).not.toBeNull();
  });

  test("no offer when nothing waits, when the other host holds another repository, or has no places", async () => {
    for (const options of [{ sourceMax: 5 }, { otherKey: "git:acme/other" }, { otherMax: 1 }]) {
      const { calls } = setup(options);
      await ready();
      await pickBoth();
      await settle(
        () =>
          calls.some(([host, type]) => host === "h2" && type === "project.list") ||
          options.sourceMax === 5,
      );
      await act1(() => {});
      expect(elsewhere("Start on beta")).toBeNull();
      cleanup();
    }
  });

  test("the offer is in Portuguese", async () => {
    setup({ language: "pt-BR" });
    await ready();
    for (const title of ["A", "B"]) await act1(() => fireEvent.click(li(title), { ctrlKey: true }));
    const startBar = screen.queryByRole("group", { name: "Seleção" });
    const start = startBar ? within(startBar).queryByRole("button", { name: "Iniciar 2" }) : null;
    expect(start).not.toBeNull();
    await act1(() => fireEvent.click(start as HTMLElement));
    await settle(() => elsewhere("Iniciar em beta") !== null);
    expect(elsewhere("Iniciar em beta")).not.toBeNull();
  });
});
