import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, stays } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { BoardView } = await import("../../src/features/board/board-view.tsx");

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
    /** Cards running on the other host now: they take its places. */
    otherRunning?: number;
    otherPaused?: boolean;
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
      hostOf("h2", "beta", {
        hostInfo: {
          daemonVersion: "x",
          features: [],
          ...(options.otherPaused ? { pause: { paused: true, running: 0 } } : {}),
        },
      }),
    ],
  });
  const cards = [card("A", "backlog", 1), card("B", "backlog", 2), running("R")];
  const away = Array.from({ length: options.otherRunning ?? 0 }, (_, n) => ({
    ...running(`X${n}`),
    projectId: "p3",
  }));
  internals.update({
    cards: {
      ...Object.fromEntries(cards.map((c) => [`h1/${c.id}`, c])),
      ...Object.fromEntries(away.map((c) => [`h2/${c.id}`, c])),
    },
  });
  const calls: Call[] = [];
  /** The boards the app loaded to count the other host's running cards. */
  const loaded: string[] = [];
  store.loadBoard = (async (hostId: string, projectId: string) => {
    loaded.push(`${hostId}/${projectId}`);
  }) as never;
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
      // The other host has a second project, of another repository: its running cards count too.
      const more = hostId === "h1" ? [] : [project("p3", "git:acme/other")];
      return { projects: [own, ...more], maxParallelRuns: max };
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
  return { store, calls, loaded };
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
    const { calls, loaded } = setup();
    await ready();
    await pickBoth();
    await settle(() => elsewhere("Start on beta") !== null);
    expect(elsewhere("Start on beta")).not.toBeNull();
    // The hint says how many go, and every board of the other host was loaded to count its runs.
    expect((dialog().textContent ?? "").includes("2 of them would wait here.")).toBe(true);
    expect([...loaded].sort((a, b) => a.localeCompare(b))).toEqual(["h2/p2", "h2/p3"]);
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
    await settle(() => (document.body.textContent ?? "").includes("2 cards started on beta"));
  });

  test("a paused host says so, makes every card wait and offers the other host too (#1481)", async () => {
    setup({ sourcePaused: true, sourceMax: 5 });
    await ready();
    await pickBoth();
    await settle(() => elsewhere("Start on beta") !== null);
    expect(elsewhere("Start on beta")).not.toBeNull();
    const text = dialog().textContent ?? "";
    // The hold is named, the queue line follows it, and nothing promises that they start now.
    expect(text.includes("alfa has new runs paused: new cards wait until you resume it.")).toBe(
      true,
    );
    expect(text.includes("They join the board's queue.")).toBe(true);
    expect(text.includes("All of them start now.")).toBe(false);
    expect(text.includes("of them would wait here")).toBe(true);
  });

  test("one card that would wait is named in the singular, and the hint ends in a full stop (#1483)", async () => {
    setup({ sourcePaused: true, sourceMax: 5 });
    await ready();
    await act1(() => fireEvent.click(li("A"), { ctrlKey: true }));
    const startBar = screen.queryByRole("group", { name: "Selection" });
    const start = startBar ? within(startBar).queryByRole("button", { name: "Start 1" }) : null;
    expect(start).not.toBeNull();
    await act1(() => fireEvent.click(start as HTMLElement));
    await settle(() => elsewhere("Start on beta") !== null);
    const text = dialog().textContent ?? "";
    expect(
      text.includes(
        "This card would wait here. Another host with the same project has a place for it.",
      ),
    ).toBe(true);
    expect(text.includes("1 of them")).toBe(false);
    expect(text.includes("has the places for them:")).toBe(false);
  });

  test("the hint of several cards ends in a full stop too (#1483)", async () => {
    setup({ sourcePaused: true, sourceMax: 5 });
    await ready();
    await pickBoth();
    await settle(() => elsewhere("Start on beta") !== null);
    expect(
      (dialog().textContent ?? "").includes(
        "2 of them would wait here. Another host with the same project has places for them.",
      ),
    ).toBe(true);
  });

  test("no offer when nothing waits, when the other host holds another repository, or has no places", async () => {
    // The first case is the control: the same setup with nothing flipped offers the host.
    for (const options of [
      {},
      { sourceMax: 5 },
      { otherKey: "git:acme/other" },
      { otherMax: 1 },
      // Its places are taken by cards running in its other project: 3 - 2 = 1 free for 2 waiting.
      { otherRunning: 2 },
      { otherPaused: true },
    ]) {
      const offered = Object.keys(options).length === 0;
      const { calls } = setup(options);
      await ready();
      await pickBoth();
      // The confirm is ready (its Start button is on) and the other host's reply has come.
      await settle(() => {
        const start = within(dialog()).queryByRole("button", { name: "Start 2" });
        return start !== null && !start.hasAttribute("disabled");
      });
      await settle(() => calls.some(([host, type]) => host === "h2" && type === "project.list"));
      if (offered) {
        await settle(() => elsewhere("Start on beta") !== null);
      } else {
        await stays(() => elsewhere("Start on beta") === null, 400);
      }
      cleanup();
    }
  });

  test("the offer is in Portuguese", async () => {
    setup({ language: "pt-BR", sourcePaused: true, sourceMax: 5 });
    await ready();
    for (const title of ["A", "B"]) await act1(() => fireEvent.click(li(title), { ctrlKey: true }));
    const startBar = screen.queryByRole("group", { name: "Seleção" });
    const start = startBar ? within(startBar).queryByRole("button", { name: "Iniciar 2" }) : null;
    expect(start).not.toBeNull();
    await act1(() => fireEvent.click(start as HTMLElement));
    await settle(() => elsewhere("Iniciar em beta") !== null);
    expect(elsewhere("Iniciar em beta")).not.toBeNull();
    const text = dialog().textContent ?? "";
    expect(
      text.includes(
        "alfa está com novas execuções pausadas: os cards novos esperam até você retomar.",
      ),
    ).toBe(true);
    expect(text.includes("Todos iniciam agora.")).toBe(false);
    expect(
      text.includes("2 deles esperariam aqui. Outro host com o mesmo projeto tem vagas para eles."),
    ).toBe(true);
  });

  test("one card in Portuguese agrees too (#1483)", async () => {
    setup({ language: "pt-BR", sourcePaused: true, sourceMax: 5 });
    await ready();
    await act1(() => fireEvent.click(li("A"), { ctrlKey: true }));
    const startBar = screen.queryByRole("group", { name: "Seleção" });
    const start = startBar ? within(startBar).queryByRole("button", { name: "Iniciar 1" }) : null;
    expect(start).not.toBeNull();
    await act1(() => fireEvent.click(start as HTMLElement));
    await settle(() => elsewhere("Iniciar em beta") !== null);
    expect(
      (dialog().textContent ?? "").includes(
        "Este card esperaria aqui. Outro host com o mesmo projeto tem vaga para ele.",
      ),
    ).toBe(true);
  });
});
