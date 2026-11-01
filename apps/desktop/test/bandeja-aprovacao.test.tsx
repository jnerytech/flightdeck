import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { needsYou, type PendingItem } from "../src/lib/app-store.ts";
import { parseRequestLink, requestLink } from "../src/lib/request-link.ts";
import { TRAY_MENU_DELAY_MS, trayMenu } from "../src/lib/tray.ts";
import type { TrayAction, TrayActionKind, TrayMenu } from "../src/platform/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { tauriPlatform } = await import("../src/platform/tauri/index.ts");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** Timers driven by hand: what was scheduled, with which delay, and how many were cancelled. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let seq = 0;
  let cancelled = 0;
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        pending.set(++seq, fn);
        delays.push(ms);
        return seq;
      },
      clearTimeout: (handle: unknown) => {
        if (pending.delete(handle as number)) cancelled++;
      },
    },
    pending,
    delays,
    cancelled: () => cancelled,
    fire: () => {
      const due = [...pending.values()];
      pending.clear();
      for (const fn of due) fn();
    },
  };
}

const item = (n: number, patch: Partial<PendingItem> = {}): PendingItem => ({
  hostId: "h1",
  hostName: "alfa",
  sessionId: `s${n}`,
  sessionName: "Gerenciada",
  requestId: `r${n}`,
  toolName: "Bash",
  createdAt: `2026-10-29T10:00:${String(n).padStart(2, "0")}.000Z`,
  input: { command: `npm test ${n}` },
  ...patch,
});

const BOTH: TrayActionKind[] = ["approve", "deny", "open"];

/** The submenu's own texts in Portuguese (phase 10: they come from the dictionary). */
const LABELS = (more: number) => ({
  approve: "Aprovar",
  deny: "Negar",
  open: "Abrir",
  more: `e mais ${more}…`,
  empty: "Nada esperando você",
  show: "Abrir",
  quit: "Sair",
});

/** The platform's tray as the store drives it: menus pushed, the action handler, window shown. */
function trayPlatform(focused = false) {
  const mem = memoryPlatform(focused);
  const menus: TrayMenu[] = [];
  let handler: ((action: TrayAction) => void) | null = null;
  let shown = 0;
  mem.platform.setTrayMenu = async (menu) => {
    menus.push(menu);
  };
  mem.platform.onTrayAction = (h) => {
    handler = h;
    return () => {
      handler = null;
    };
  };
  mem.platform.showMainWindow = async () => {
    shown++;
  };
  return {
    mem,
    menus,
    act: (action: TrayAction) => handler?.(action),
    hasHandler: () => handler !== null,
    shown: () => shown,
  };
}

const status = (d: ReturnType<typeof makeDaemon>, requestId: string) =>
  (
    d.eventStore.db.query("SELECT status FROM permission_requests WHERE id = ?").get(requestId) as {
      status: string;
    } | null
  )?.status;

describe("bandeja-aprovacao", () => {
  test("submenu: host · sessão · ferramenta: resumo, até 10, gates só com Abrir, e mais N", () => {
    expect(trayMenu([])).toEqual({ items: [], more: 0, labels: LABELS(0) });
    expect(
      trayMenu([
        item(1),
        item(2, {
          hostId: "h2",
          hostName: "beta",
          sessionName: "app",
          toolName: "Write",
          external: true,
          input: { file_path: "C:\\app\\a.txt", content: "texto" },
        }),
        item(3, {
          sessionName: "Card X",
          toolName: "gate revisão",
          input: undefined,
          gate: { runId: "run", stepId: "revisão", attempt: 1, cardId: "c1" },
        }),
        item(4, { toolName: "Read", input: undefined }),
        item(5, { input: { command: "x".repeat(100) } }),
      ]),
    ).toEqual({
      items: [
        { key: "h1/r1", label: "alfa · Gerenciada · Bash: npm test 1", actions: BOTH },
        { key: "h2/r2", label: "beta · app · Write: C:\\app\\a.txt", actions: BOTH },
        { key: "h1/r3", label: "alfa · Card X · gate revisão", actions: ["open"] },
        { key: "h1/r4", label: "alfa · Gerenciada · Read", actions: BOTH },
        { key: "h1/r5", label: `alfa · Gerenciada · Bash: ${"x".repeat(80)}…`, actions: BOTH },
      ],
      more: 0,
      labels: LABELS(0),
    });
    const twelve = trayMenu(Array.from({ length: 12 }, (_, i) => item(i + 1)));
    expect(twelve.items.map((i) => i.key)).toEqual(
      Array.from({ length: 10 }, (_, i) => `h1/r${i + 1}`),
    );
    expect(twelve.more).toBe(2);
  });

  test("a lista refeita com debounce de 500 ms; Aprovar e Negar chegam ao permission.respond; Abrir e e mais N abrem o app", async () => {
    const d = makeDaemon(cleanups);
    const tray = trayPlatform(true);
    const clock = manualTimers();
    const store = new AppStore(tray.mem.platform, { baseDelayMs: 60_000, timers: clock.timers });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online" && tray.hasHandler());
    expect(tray.hasHandler()).toBe(true);

    const first = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "Gerenciada" });
    await poll(() => d.manager.pendingPermissions(first.sessionId).length === 1);
    const r1 = d.manager.pendingPermissions(first.sessionId)[0]?.requestId ?? "";
    // The request is in the app's state and the debounce is armed: only then does the clock fire.
    await settle(() => needsYou(store.getState()).length === 1 && clock.pending.size === 1);
    // Nothing goes to the tray until the list settles for 500 ms: changes reset the wait.
    expect(tray.menus).toEqual([]);
    expect(clock.pending.size).toBe(1);
    expect(clock.delays.every((ms) => ms === TRAY_MENU_DELAY_MS)).toBe(true);
    expect(TRAY_MENU_DELAY_MS).toBe(500);
    await act(async () => clock.fire());
    const hostId = store.getState().hosts[0]?.id ?? "";
    expect(tray.menus.at(-1)).toEqual({
      items: [
        {
          key: `${hostId}/${r1}`,
          label: "alfa · Gerenciada · Bash: npm test --silent",
          actions: BOTH,
        },
      ],
      more: 0,
      labels: LABELS(0),
    });

    // Abrir: the window comes up on the request's session.
    await act(async () => tray.act({ key: `${hostId}/${r1}`, action: "open" }));
    expect(tray.shown()).toBe(1);
    await settle(() => screen.queryByRole("heading", { name: "Gerenciada" }) !== null);
    expect(screen.queryByRole("heading", { name: "Gerenciada" })).not.toBeNull();

    // Aprovar answers through permission.respond, without the window.
    await act(async () => tray.act({ key: `${hostId}/${r1}`, action: "approve" }));
    await poll(() => status(d, r1) !== "pending");
    expect(status(d, r1)).toBe("allowed");
    expect(tray.shown()).toBe(1);

    const second = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "Outra" });
    await poll(() => d.manager.pendingPermissions(second.sessionId).length === 1);
    const r2 = d.manager.pendingPermissions(second.sessionId)[0]?.requestId ?? "";
    // The tray ignores a request the app does not know yet: wait until it is in the state.
    await settle(() => needsYou(store.getState()).some((i) => i.requestId === r2));
    expect(needsYou(store.getState()).some((i) => i.requestId === r2)).toBe(true);
    await act(async () => tray.act({ key: `${hostId}/${r2}`, action: "deny" }));
    await poll(() => status(d, r2) !== "pending");
    expect(status(d, r2)).toBe("denied");

    // The emptied list goes to the tray too; "e mais N…" just brings the app up.
    // Both sessions are in the state and neither waits any more (an absent session would pass too).
    await settle(
      () =>
        store.getState().hosts[0]?.sessions.length === 2 && needsYou(store.getState()).length === 0,
    );
    expect(store.getState().hosts[0]?.sessions).toHaveLength(2);
    await act(async () => clock.fire());
    expect(tray.menus.at(-1)).toEqual({ items: [], more: 0, labels: LABELS(0) });
    await act(async () => tray.act({ key: "more", action: "open" }));
    expect(tray.shown()).toBe(2);
    // An unknown key (a request already answered elsewhere) does nothing.
    await act(async () => tray.act({ key: `${hostId}/${r1}`, action: "approve" }));
    expect(store.getState().error).toBeNull();
  });

  test("a notificação do pedido leva o deep link flightdeck://, que abre o app focado no pedido", async () => {
    expect(parseRequestLink(requestLink("h/1", "r 2"))).toEqual({
      hostId: "h/1",
      requestId: "r 2",
    });
    expect(requestLink("h1", "r1")).toBe("flightdeck://request?host=h1&request=r1");
    expect(parseRequestLink("flightdeck://10.0.0.5:7777?token=abc")).toBeNull();
    expect(parseRequestLink("não é link")).toBeNull();

    const d = makeDaemon(cleanups);
    const tray = trayPlatform(false);
    const store = new AppStore(tray.mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "Pedinte" });
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
    await settle(() => tray.mem.shown.length > 0);
    expect(tray.mem.notifications.at(-1)?.title).toBe("alfa · Pedinte: esperando você");
    const notification = tray.mem.shown.at(-1);
    expect(typeof notification?.onclick).toBe("function");
    await act(async () => notification?.onclick?.());
    await settle(() => screen.queryByRole("heading", { name: "Pedinte" }) !== null);
    expect(screen.queryByRole("heading", { name: "Pedinte" })).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("o link de um pedido já respondido só traz o app, sem banner nem formulário de host", async () => {
    const tray = trayPlatform(false);
    const store = new AppStore(tray.mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await settle(() => tray.hasHandler());
    await act(async () => tray.mem.deepLink(requestLink("h1", "respondido")));
    expect(tray.shown()).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByText("Este link veio de fora do app. Confira os dados antes de salvar."),
    ).toBeNull();
  });

  test("a casca Tauri recebe o submenu e repassa os cliques", async () => {
    const calls: Array<[string, unknown]> = [];
    const call = (async (cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
    }) as Parameters<typeof tauriPlatform>[1];
    let listener: ((event: { payload: TrayAction }) => void) | null = null;
    let unlistened = 0;
    const listen = (async (event: string, handler: (event: { payload: TrayAction }) => void) => {
      expect(event).toBe("tray-action");
      listener = handler;
      return () => {
        unlistened++;
      };
    }) as Parameters<typeof tauriPlatform>[2];
    const win = {
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { hasFocus: () => true },
      navigator: { clipboard: { writeText: async () => {} } },
    };
    const platform = tauriPlatform(win, call, listen);
    const menu = {
      items: [{ key: "h1/r1", label: "alfa · s · Bash", actions: BOTH }],
      more: 3,
      labels: LABELS(3),
    };
    await platform.setTrayMenu(menu as TrayMenu);
    expect(calls).toEqual([["tray_set_menu", menu]]);
    const got: TrayAction[] = [];
    const stop = platform.onTrayAction((action) => got.push(action));
    await Bun.sleep(0);
    (listener as ((event: { payload: TrayAction }) => void) | null)?.({
      payload: { key: "h1/r1", action: "deny" },
    });
    expect(got).toEqual([{ key: "h1/r1", action: "deny" }]);
    stop();
    await Bun.sleep(0);
    expect(unlistened).toBe(1);
  });
});
