import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ResourcesSnapshot } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { HostResources } = await import("../src/components/hosts/host-resources.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1343: a card that waits for memory says so on the board, and the host's Resources panel
 * sets the share of used memory from which new cards wait.
 */

const card = (over: object = {}) => ({
  id: "c1",
  projectId: "p1",
  title: "Heavy build",
  description: "",
  column: "in_progress",
  columnLocked: false,
  position: 1,
  slug: "heavy",
  branch: "fd/heavy",
  worktreePath: null,
  prUrl: null,
  prState: null,
  checksState: null,
  queued: true,
  sessionId: null,
  sessionStatus: null,
  notice: null,
  discarded: false,
  runs: [],
  workflowRunId: null,
  arenaOf: null,
  variant: null,
  arenaVariants: 0,
  issueRef: null,
  issueExternal: false,
  queueReason: "memory",
  quotaUntil: null,
  waitingOn: [],
  blocking: [],
  createdAt: "2026-11-08T12:00:00.000Z",
  updatedAt: "2026-11-08T12:00:00.000Z",
  ...over,
});

const hostRow = (features: string[]) => ({
  id: "h1",
  name: "pi",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function board(language: "en" | "pt-BR", over: object = {}) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  (store as unknown as { update(p: object): void }).update({
    hosts: [hostRow([])],
    projects: { h1: [{ id: "p1", name: "api", path: "/x/api" }] },
    cards: { "h1/c1": card(over) },
  });
  store.hostCommand = (async (_hostId: string, type: string) =>
    type === "board.get"
      ? { project: { id: "p1", name: "api" }, cards: [card(over)] }
      : {}) as never;
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
}

const GB = 1024 ** 3;
const snapshot = (memoryPauseAt: number | null | undefined): ResourcesSnapshot => ({
  at: "2026-11-08T12:00:00.000Z",
  memory: { totalBytes: 8 * GB, freeBytes: 0.5 * GB },
  disk: null,
  loadPercent: null,
  measured: true,
  reason: null,
  rows: [],
  orphans: [],
  ...(memoryPauseAt === undefined ? {} : { memoryPauseAt }),
});

function resources(features: string[], memoryPauseAt: number | null | undefined) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const asked: Array<[string, unknown]> = [];
  let pauseAt = memoryPauseAt;
  (store as unknown as { dispatch: unknown }).dispatch = (async (
    _host: string,
    type: string,
    payload: { pauseAt?: number | null },
  ) => {
    asked.push([type, payload]);
    if (type === "resources.get") return snapshot(pauseAt);
    if (type === "resources.setPauseAt") {
      pauseAt = payload.pauseAt ?? null;
      return { pauseAt };
    }
    return {};
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <HostResources store={store} host={hostRow(features) as never} active everyMs={600_000} />
    </TContext.Provider>,
  );
  return { asked };
}

describe("memory hold on the board and the host (#1343)", () => {
  test("a card waiting for memory says so, in both languages", async () => {
    board("en");
    await settleMaybe(() => screen.queryByText("waiting for memory") !== null);
    expect(screen.queryByText("waiting for memory")).not.toBeNull();
    cleanup();
    board("pt-BR");
    await settleMaybe(() => screen.queryByText("aguardando memória") !== null);
    expect(screen.queryByText("aguardando memória")).not.toBeNull();
  });

  // Issue #1429: "waiting for memory" already says the card is queued, and why.
  test("a card waiting for memory shows one badge, the reason, and a card waiting for a slot still says queued", async () => {
    const shown = async (language: "en" | "pt-BR", over: object, texts: string[]) => {
      board(language, over);
      await settleMaybe(() => screen.queryByText(texts[0] ?? "") !== null);
      const seen = texts.map((text) => screen.queryByText(text) !== null);
      cleanup();
      return seen;
    };
    expect([
      await shown("en", {}, ["waiting for memory", "queued"]),
      await shown("pt-BR", {}, ["aguardando memória", "na fila"]),
      await shown("en", { queueReason: "slot" }, ["queued", "waiting for memory"]),
      await shown("pt-BR", { queueReason: "slot" }, ["na fila", "aguardando memória"]),
      // The other two reasons that name themselves: no second "queued" beside them either.
      await shown("en", { queueReason: "quota" }, ["waiting for the quota", "queued"]),
      await shown("en", { queueReason: "paused" }, ["waiting: host paused", "queued"]),
    ]).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [true, false],
      [true, false],
      [true, false],
    ]);
  });

  test("the Resources panel sets the share from which new cards wait, and Never turns it off", async () => {
    const { asked } = resources(["resources", "memoryPause"], 0.9);
    const select = () =>
      screen.queryByLabelText("New cards wait from memory at, on pi") as HTMLSelectElement | null;
    await settleMaybe(() => select() !== null);
    expect(select()?.value).toBe("0.9");
    await act(async () => {
      fireEvent.change(select() as HTMLSelectElement, { target: { value: "0.8" } });
    });
    await settleMaybe(() => select()?.value === "0.8");
    const sets = () => asked.filter(([type]) => type === "resources.setPauseAt");
    expect(sets()).toEqual([["resources.setPauseAt", { pauseAt: 0.8 }]]);
    await act(async () => {
      fireEvent.change(select() as HTMLSelectElement, { target: { value: "off" } });
    });
    await settleMaybe(() => select()?.value === "off");
    expect(sets()).toEqual([
      ["resources.setPauseAt", { pauseAt: 0.8 }],
      ["resources.setPauseAt", { pauseAt: null }],
    ]);
  });

  test("a host without the setting shows no picker", async () => {
    const { asked } = resources(["resources"], undefined);
    const memory = () => document.querySelector("[data-slot='resources-memory']") !== null;
    await settleMaybe(memory);
    expect(memory()).toBe(true);
    // The picker would come with the memory section; watch the window, not one read.
    const noPicker = () => screen.queryByLabelText("New cards wait from memory at, on pi") === null; // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await stays(noPicker);
    expect(asked.filter(([type]) => type === "resources.setPauseAt")).toEqual([]);
  });
});
