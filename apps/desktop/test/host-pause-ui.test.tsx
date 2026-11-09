import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { useStoreSlice } = await import("../src/lib/use-store.ts");
const { statusBarSummary } = await import("../src/lib/status-bar.ts");
const { StatusBar, StatusBarSlot } = await import("../src/components/shell/status-bar.tsx");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { HostPausePanel } = await import("../src/components/hosts/host-pause-panel.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1404: a card waiting on a paused host says so on the board, the host page pauses and
 * resumes new runs, and the status bar names the paused host so the pause is not forgotten.
 */

type Pause = { paused: boolean; running: number };

const card = {
  id: "c1",
  projectId: "p1",
  title: "Later",
  description: "",
  column: "in_progress",
  columnLocked: false,
  position: 1,
  slug: "later",
  branch: "fd/later",
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
  queueReason: "paused",
  quotaUntil: null,
  waitingOn: [],
  blocking: [],
  createdAt: "2026-11-09T12:00:00.000Z",
  updatedAt: "2026-11-09T12:00:00.000Z",
};

const hostRow = (pause?: Pause, status = "online") => ({
  id: "h1",
  name: "pi",
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: {
    daemonVersion: "x",
    features: pause ? ["hostPause"] : [],
    ...(pause ? { pause } : {}),
  },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

function storeIn(language: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  return store;
}
type Store = ReturnType<typeof storeIn>;
const update = (store: Store, patch: object) =>
  (store as unknown as { update(p: object): void }).update(patch);

function board(language: "en" | "pt-BR") {
  const store = storeIn(language);
  update(store, {
    hosts: [hostRow()],
    projects: { h1: [{ id: "p1", name: "api", path: "/x/api" }] },
    cards: { "h1/c1": card },
  });
  store.hostCommand = (async (_hostId: string, type: string) =>
    type === "board.get" ? { project: { id: "p1", name: "api" }, cards: [card] } : {}) as never;
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

/** The panel of the store's first host, drawn again as the store changes. */
function PanelOfFirstHost({ store }: Readonly<{ store: Store }>) {
  const { hosts } = useStoreSlice(store, ["hosts"]);
  const host = hosts[0];
  return host ? <HostPausePanel store={store} host={host} /> : null;
}

/** The panel over a host whose pause the fake commands change, as the daemon does. */
function panel(language: "en" | "pt-BR", pause?: Pause) {
  const store = storeIn(language);
  update(store, { hosts: [hostRow(pause)] });
  const asked: Array<[string, unknown]> = [];
  let now = pause;
  store.hostCommand = (async (_host: string, type: string, payload: { paused: boolean }) => {
    asked.push([type, payload]);
    if (type === "host.pause" && now) now = { ...now, paused: payload.paused };
    return now ?? {};
  }) as never;
  store.reloadHostInfo = (async () => update(store, { hosts: [hostRow(now)] })) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PanelOfFirstHost store={store} />
    </TContext.Provider>,
  );
  return { asked };
}

const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
  });
};

describe("host pause on the board, the host page and the status bar (#1404)", () => {
  test("a card waiting on a paused host says so, in both languages", async () => {
    board("en");
    await settleMaybe(() => screen.queryByText("waiting: host paused") !== null);
    expect(screen.queryByText("waiting: host paused")).not.toBeNull();
    cleanup();
    board("pt-BR");
    await settleMaybe(() => screen.queryByText("aguardando: host pausado") !== null);
    expect(screen.queryByText("aguardando: host pausado")).not.toBeNull();
  });

  test("the host page pauses new runs, says when it is safe, and resumes them", async () => {
    const { asked } = panel("en", { paused: false, running: 0 });
    await settleMaybe(() => screen.queryByText("New runs start as usual.") !== null);
    expect(screen.queryByText("New runs start as usual.")).not.toBeNull();
    await press("Pause new runs");
    await settleMaybe(() => screen.queryByRole("button", { name: "Resume new runs" }) !== null);
    expect(asked).toContainEqual(["host.pause", { paused: true }]);
    expect(
      screen.queryByText("New runs are paused. Nothing is running: safe to restart or update."),
    ).not.toBeNull();
    await press("Resume new runs");
    await settleMaybe(() => screen.queryByText("New runs start as usual.") !== null);
    expect(asked.at(-1)).toEqual(["host.pause", { paused: false }]);
  });

  test("while sessions still run, the page counts them; in Portuguese too; none on an older host", async () => {
    panel("en", { paused: true, running: 2 });
    await settleMaybe(() => screen.queryByText("New runs are paused. 2 still running.") !== null);
    expect(screen.queryByText("New runs are paused. 2 still running.")).not.toBeNull();
    cleanup();
    panel("pt-BR", { paused: false, running: 0 });
    await settleMaybe(() => screen.queryByText("Novas execuções começam normalmente.") !== null);
    expect(screen.queryByRole("button", { name: "Pausar novas execuções" })).not.toBeNull();
    cleanup();
    panel("en");
    expect(screen.queryByRole("button", { name: "Pause new runs" }) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("the status bar summary names the first online host whose new runs are paused", () => {
    const state = (hosts: object[]) =>
      ({ hosts, appUpdate: {}, settings: {} }) as unknown as Parameters<typeof statusBarSummary>[0];
    expect(statusBarSummary(state([hostRow({ paused: true, running: 2 })]), 0).paused).toEqual({
      hostId: "h1",
      hostName: "pi",
      running: 2,
    });
    expect(statusBarSummary(state([hostRow({ paused: false, running: 2 })]), 0).paused).toBeNull();
    expect(
      statusBarSummary(state([hostRow({ paused: true, running: 0 }, "offline")]), 0).paused,
    ).toBeNull();
  });

  test("the status bar reads a paused host again as its sessions change, on any page", async () => {
    const store = storeIn("en");
    const reloaded: string[] = [];
    store.reloadHostInfo = (async (id: string) => void reloaded.push(id)) as never;
    const withSessions = (pause: Pause, status: string) => ({
      ...hostRow(pause),
      sessions: [{ id: "s1", status }],
    });
    const slot = (hosts: object[]) => (
      <StatusBarSlot
        t={store.i18n.t}
        state={{ hosts, quota: {}, appUpdate: {}, settings: {} } as never}
        now={0}
        terminalTabs={0}
        refreshing={false}
        store={store}
        onRefreshQuota={() => {}}
        onOpenTerminals={() => {}}
        go={() => {}}
      />
    );
    const { rerender } = render(slot([withSessions({ paused: true, running: 1 }, "running")]));
    rerender(slot([withSessions({ paused: true, running: 1 }, "idle")]));
    await settleMaybe(() => reloaded.length >= 2);
    expect(reloaded).toEqual(["h1", "h1"]);
    cleanup();
    reloaded.length = 0;
    const { rerender: again } = render(
      slot([withSessions({ paused: false, running: 1 }, "running")]),
    );
    again(slot([withSessions({ paused: false, running: 1 }, "idle")]));
    expect(reloaded).toEqual([]);
  });

  for (const [lang, running, idle] of [
    ["en", "New runs paused on pi: 2 still running", "New runs paused on pi: idle, safe to update"],
    [
      "pt-BR",
      "Novas execuções pausadas em pi: 2 ainda rodando",
      "Novas execuções pausadas em pi: ocioso, pode atualizar",
    ],
  ] as const) {
    test(`the status bar item names the paused host and opens it (${lang})`, async () => {
      const opened: string[] = [];
      const summary = {
        hostsOnline: 1,
        hostsTotal: 1,
        terminals: 0,
        keepAwake: null,
        keepAwakeHostId: null,
        update: null,
        updateVersion: null,
      };
      const draw = (n: number) =>
        render(
          <StatusBar
            t={translator(lang)}
            quota={null}
            refreshing={false}
            summary={{ ...summary, paused: { hostId: "h1", hostName: "pi", running: n } }}
            onRefreshQuota={() => {}}
            onOpenQuota={() => {}}
            onOpenKeepAwake={() => {}}
            onOpenPause={(id) => opened.push(id)}
            onOpenTerminals={() => {}}
            onOpenHosts={() => {}}
            onOpenUpdate={() => {}}
          />,
        );
      draw(2);
      expect(screen.queryByRole("button", { name: running })).not.toBeNull();
      await press(running);
      expect(opened).toEqual(["h1"]);
      cleanup();
      draw(0);
      expect(screen.queryByRole("button", { name: idle })).not.toBeNull();
    });
  }
});
