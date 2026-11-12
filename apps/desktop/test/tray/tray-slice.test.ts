import { describe, expect, test } from "bun:test";
import { TraySlice } from "../../src/features/tray/index.ts";
import { TRAY_MENU_DELAY_MS } from "../../src/features/tray/tray.ts";
import { translator } from "../../src/i18n/index.ts";
import type { PendingItem } from "../../src/lib/app-store.ts";
import type { TrayAction } from "../../src/platform/types.ts";

const t = translator("en");

const item = (requestId: string, over: Partial<PendingItem> = {}) =>
  ({
    hostId: "h1",
    hostName: "pc",
    requestId,
    toolName: "Bash",
    input: {},
    ...over,
  }) as PendingItem;

/** A tray over stand-ins: what the platform was told, what the store was asked, and a timer by hand. */
function tray() {
  const log: unknown[] = [];
  const waits: number[] = [];
  const world = {
    items: [] as PendingItem[],
    hosts: [{ id: "h1", name: "pc", sessions: [] as unknown[] }],
    sessions: {} as Record<string, unknown>,
    simple: new Set<string>(),
    uiHost: "h1" as string | null,
  };
  let clicked: ((action: TrayAction) => void) | null = null;
  let listeners = 0;
  let timer: (() => void) | null = null;
  const slice = new TraySlice(
    {
      setTrayStatus: async (status) => void log.push({ status: status.tooltip }),
      setTrayMenu: async (menu) => void log.push({ menu: menu.items.map((i) => i.key) }),
      setTitle: async (title) => void log.push({ title }),
      showMainWindow: async () => void log.push("window"),
      onTrayAction: (handler) => {
        clicked = handler;
        listeners++;
        return () => {
          listeners--;
          clicked = null;
        };
      },
    },
    {
      state: () => ({ hosts: world.hosts, sessions: world.sessions }) as never,
      needsYou: () => world.items,
      t: () => t,
      uiHostId: () => world.uiHost,
      isSimple: (hostId) => world.simple.has(hostId),
      answer: (hostId, requestId, decision) =>
        void log.push({ answer: [hostId, requestId, decision] }),
      open: (pending) => void log.push({ open: pending.requestId }),
      timers: {
        setTimeout: (fn, ms) => {
          waits.push(ms);
          timer = fn;
          return fn;
        },
        clearTimeout: (handle) => {
          if (timer === handle) timer = null;
        },
      },
    },
  );
  return {
    slice,
    log,
    waits,
    world,
    click: (action: TrayAction) => clicked?.(action),
    listeners: () => listeners,
    fire: () => {
      const due = timer;
      timer = null;
      due?.();
    },
    waiting: () => timer !== null,
  };
}

/** A selection that is truthy: only its presence matters to the tray. */
const shown = { hostId: "h1" } as never;

const withPermissions = (n: number) => [
  { pendingPermissions: Array.from({ length: n }, (_, i) => ({ requestId: `r${i}` })) },
];

describe("tray (#1596)", () => {
  test("the badge follows the hosts, and the platform is told only when it changes", () => {
    const { slice, log, world } = tray();
    world.hosts = [{ id: "h1", name: "pc", sessions: withPermissions(2) }];
    slice.changed({ hosts: [] });
    slice.changed({ hosts: [] });
    world.hosts = [{ id: "h1", name: "pc", sessions: withPermissions(1) }];
    slice.changed({ uiChoices: {} });
    expect(log).toEqual([
      { status: t("tray.waiting", { n: 2, hosts: "pc: 2" }) },
      { status: t("tray.waiting", { n: 1, hosts: "pc: 1" }) },
    ]);
  });

  test("the badge counts what the daemon approved by itself", () => {
    const { slice, log, world } = tray();
    world.sessions = {
      s1: {
        items: [
          { kind: "permission", resolution: { auto: true } },
          { kind: "permission", resolution: { auto: false } },
          { kind: "message" },
        ],
      },
    };
    slice.changed({ hosts: [] });
    expect(log).toEqual([{ status: `${t("tray.idle")} · ${t("tray.autoApproved", { n: 1 })}` }]);
  });

  test("a simple-mode host's window title says how many tasks wait, and full mode leaves it alone", () => {
    const { slice, log, world } = tray();
    world.items = [item("r1"), item("r2"), item("r3", { hostId: "h2" })];
    slice.changed({ selected: shown });
    expect(log).toEqual([]);
    world.simple.add("h1");
    slice.changed({ selected: shown });
    slice.changed({ externals: {} });
    world.items = [];
    slice.changed({ runs: {} });
    expect(log).toEqual([
      { title: t("simple.windowTitle.waiting", { n: 2 }) },
      { title: t("simple.windowTitle.idle") },
    ]);
  });

  test("the title stays put with no host shown", () => {
    const { slice, log, world } = tray();
    world.uiHost = null;
    slice.changed({ selected: shown });
    expect(log).toEqual([]);
  });

  test("the submenu waits for the list to settle, and a second change restarts the wait", () => {
    const { slice, log, waits, world, fire, waiting } = tray();
    world.items = [item("r1")];
    slice.changed({ externalRequests: {} });
    world.items = [item("r1"), item("r2")];
    slice.changed({ cards: {} });
    expect(waits).toEqual([TRAY_MENU_DELAY_MS, TRAY_MENU_DELAY_MS]);
    expect(log).toEqual([]);
    fire();
    expect(log).toEqual([{ menu: ["h1/r1", "h1/r2"] }]);
    expect(waiting()).toBe(false);
  });

  test("a menu that did not change schedules nothing", () => {
    const { slice, waits, world, fire } = tray();
    world.items = [item("r1")];
    slice.changed({ runs: {} });
    fire();
    slice.changed({ runs: {} });
    expect(waits).toEqual([TRAY_MENU_DELAY_MS]);
  });

  test("a state change that does not touch the tray does nothing", () => {
    const { slice, log, world } = tray();
    world.items = [item("r1")];
    slice.changed({});
    expect(log).toEqual([]);
  });

  test("a new language rewords the badge and the submenu at once, with no wait", () => {
    const { slice, log, world, waiting } = tray();
    world.items = [item("r1")];
    slice.languageChanged();
    expect(log).toEqual([{ status: t("tray.idle") }, { menu: ["h1/r1"] }]);
    expect(waiting()).toBe(false);
  });

  test("approve and deny answer on the host without the window", () => {
    const { slice, log, world, click } = tray();
    world.items = [item("r1"), item("r2")];
    slice.start();
    click({ key: "h1/r1", action: "approve" });
    click({ key: "h1/r2", action: "deny" });
    expect(log).toEqual([{ answer: ["h1", "r1", "allow"] }, { answer: ["h1", "r2", "deny"] }]);
  });

  test("what must be seen first is opened: a high-risk approve, a vault grant, a gate and an open click", () => {
    const { slice, log, world } = tray();
    world.items = [
      item("high", { risk: "high" }),
      item("vault", { vault: {} as never }),
      item("gate", { gate: { stepId: "s" } as never }),
      item("plain"),
    ];
    slice.act({ key: "h1/high", action: "approve" });
    slice.act({ key: "h1/vault", action: "approve" });
    slice.act({ key: "h1/gate", action: "approve" });
    slice.act({ key: "h1/plain", action: "open" });
    slice.act({ key: "h1/high", action: "deny" });
    expect(log).toEqual([
      { open: "high" },
      { open: "vault" },
      { open: "gate" },
      { open: "plain" },
      { answer: ["h1", "high", "deny"] },
    ]);
  });

  test("the more line shows the window, and a request that is gone is ignored", () => {
    const { slice, log } = tray();
    slice.act({ key: "more", action: "open" });
    slice.act({ key: "h1/gone", action: "approve" });
    expect(log).toEqual(["window"]);
  });

  test("a second start replaces the listener, and stop lets go of it", () => {
    const { slice, listeners } = tray();
    slice.start();
    slice.start();
    expect(listeners()).toBe(1);
    slice.stop();
    slice.stop();
    expect(listeners()).toBe(0);
  });

  test("stop cancels the submenu wait, so a closed app sends no menu after it", () => {
    const { slice, log, world, fire, waiting } = tray();
    world.items = [item("r1")];
    slice.changed({ externalRequests: {} });
    expect(waiting()).toBe(true);
    slice.stop();
    expect(waiting()).toBe(false);
    fire();
    expect(log).toEqual([]);
  });
});
