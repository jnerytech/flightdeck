import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { Board } from "../../daemon/src/board/board.ts";
import { Central } from "../../daemon/src/central/central.ts";
import type { Budgets } from "../../daemon/src/costs/budgets.ts";
import { Costs } from "../../daemon/src/costs/costs.ts";
import { DEFAULT_PRICING } from "../../daemon/src/costs/pricing.ts";
import { HistoryIndexer } from "../../daemon/src/history/indexer.ts";
import { Maintenance } from "../../daemon/src/maintenance/maintenance.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { UsageLedger } from "../../daemon/src/quota/usage.ts";
import { FakeRuntime } from "../../daemon/src/runtime/fake-runtime.ts";
import { type RunningServer, startServer } from "../../daemon/src/server.ts";
import { SessionManager } from "../../daemon/src/sessions/session-manager.ts";
import { EventStore } from "../../daemon/src/store/event-store.ts";
import { createWebPlatform, type WebWindow } from "../src/platform/web/index.ts";

export const TOKEN = "desktop-test-token-0123456789";

export async function waitFor<T>(
  check: () => T | undefined | null | false,
  label = "condição",
): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await Bun.sleep(5);
  }
}

/**
 * In-process daemon with the FakeRuntime and a board; `listen` can be called again on the same port. Its
 * history index reads `historyRoot` (a fake `~/.claude/projects`); call `history.scan()` after
 * writing transcripts there.
 */
export function daemon(
  cleanups: Array<() => unknown>,
  options: {
    allowApiKey?: boolean;
    baseEnv?: Record<string, string>;
    /** Turns on maintenance (backups in `<root>/data/backups`) with this retention. */
    retention?: { eventsDays: number; externalSessionsDays: number };
    /** The host's plan quota (phase 7); pass one on a manual clock to drive it. */
    quota?: Quota;
    /** What `host.info` says for "Abrir no terminal" (phase 8). */
    terminal?: { flightdeckdPath: string | null; wslDistro: string | null };
    /** Estimated costs (phase 8) over this daemon's own usage entries. */
    costs?: boolean;
    /** Budgets (phase 8), built over this daemon's database. */
    budgets?: (db: EventStore["db"]) => Budgets;
  } = {},
) {
  const root = realTempDir("fd-desk-");
  const project = join(root, "p");
  mkdirSync(project);
  const store = new EventStore(":memory:");
  const historyRoot = join(root, "claude-projects");
  mkdirSync(historyRoot);
  const history = new HistoryIndexer({ db: store.db, roots: [historyRoot] });
  const runtime = new FakeRuntime({ delayMs: 1 });
  // The host's plan quota and usage (phase 7): pass a quota on a manual clock to drive it.
  const quota = options.quota ?? new Quota({ pauseAt: 0.9 });
  cleanups.push(() => quota.stop());
  const usage = new UsageLedger({ db: store.db, projectKey: (cwd) => cwd });
  const manager = new SessionManager({
    onQuota: (readings) => quota.record(readings),
    onTurn: (sessionId, cwd, turn) => usage.record(sessionId, cwd, turn),
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: options.allowApiKey ?? false,
    baseEnv: options.baseEnv ?? {},
  });
  const board = new Board({ db: store.db, manager, allowedRoots: [root], quota });
  cleanups.push(() => board.stop());
  // Hooks go to a settings.json of this daemon only, never the home of the test process.
  const settingsFile = join(root, "claude-home", "settings.json");
  const configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify({ token: TOKEN }));
  const central = new Central({
    db: store.db,
    manager,
    hooks: { port: 0, permissionTimeoutS: 600, staleAfterS: 900 },
    dataDir: join(root, "data"),
    hostName: "h1",
    configFile,
    selfCommand: [process.execPath, "run", "flightdeckd.ts"],
    settingsPath: () => settingsFile,
  });
  cleanups.push(() => central.stop());
  // The daemon's database lives in its dataDir, so the folder always exists there.
  if (options.retention) mkdirSync(join(root, "data"), { recursive: true });
  const maintenance = options.retention
    ? new Maintenance({
        db: store.db,
        dataDir: join(root, "data"),
        retention: { usageDays: 400, ...options.retention },
        backup: { enabled: true, keep: 7 },
      })
    : undefined;
  const costs = options.costs ? new Costs({ db: store.db, pricing: DEFAULT_PRICING }) : undefined;
  const budgets = options.budgets?.(store.db);
  /** `features` replaces what `host.info` announces (a host without some phase 7 feature). */
  const listen = (port = 0, pingIntervalMs?: number, features?: string[]): RunningServer => {
    const server = startServer({
      ...(pingIntervalMs ? { pingIntervalMs } : {}),
      ...(features ? { features } : {}),
      manager,
      history,
      board,
      quota,
      usage,
      central,
      ...(maintenance ? { maintenance } : {}),
      ...(options.terminal ? { terminal: options.terminal } : {}),
      ...(costs ? { costs } : {}),
      ...(budgets ? { budgets } : {}),
      hostName: "h1",
      bind: "127.0.0.1",
      port,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    return server;
  };
  return {
    quota,
    usage,
    costs,
    budgets,
    manager,
    project,
    root,
    listen,
    history,
    historyRoot,
    runtime,
    board,
    central,
    maintenance,
    settingsFile,
    configFile,
    eventStore: store,
  };
}

/**
 * The web platform over a fake window: the UI tests run on the same implementation the PWA will
 * use. Tokens live in `tokens` (injected as the secrets map); notifications are recorded through
 * a fake browser Notification API.
 */
export function memoryPlatform(focused = false) {
  const items = new Map<string, string>();
  const tokens = new Map<string, string>();
  const notifications: Array<{ title: string; body: string }> = [];
  /** The notification objects themselves, to simulate a click (`onclick`). */
  const shown: Array<{ onclick?: (() => void) | null }> = [];
  /** Files saved through the save dialog; `cancelSave` makes the next dialog a cancel. */
  const saved: Array<{ name: string; text: string }> = [];
  const save = { cancel: false };
  let onHashChange: (() => void) | null = null;
  const win: WebWindow = {
    localStorage: {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    },
    document: { hasFocus: () => focused, title: "Flightdeck" },
    location: { hash: "" },
    open: () => null,
    addEventListener: (_type, listener) => {
      onHashChange = listener;
    },
    removeEventListener: () => {
      onHashChange = null;
    },
    showSaveFilePicker: async ({ suggestedName }) => {
      if (save.cancel) {
        save.cancel = false;
        throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
      }
      return {
        createWritable: async () => {
          let text = "";
          return {
            write: async (chunk: string) => {
              text += chunk;
            },
            close: async () => {
              saved.push({ name: suggestedName, text });
            },
          };
        },
      };
    },
    Notification: Object.assign(
      function (this: { onclick?: () => void }, title: string, options?: { body?: string }) {
        notifications.push({ title, body: options?.body ?? "" });
        shown.push(this);
      } as unknown as NonNullable<WebWindow["Notification"]>,
      { permission: "granted", requestPermission: async () => "granted" },
    ),
  };
  const platform = createWebPlatform(win, tokens);
  /** Simulates the OS opening a `flightdeck://` link. */
  const deepLink = (url: string) => {
    win.location.hash = `#link=${encodeURIComponent(url)}`;
    onHashChange?.();
  };
  return { platform, items, tokens, notifications, shown, win, deepLink, saved, save };
}
