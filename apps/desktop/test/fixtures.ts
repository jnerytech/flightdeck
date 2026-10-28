import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryIndexer } from "../../daemon/src/history/indexer.ts";
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
 * In-process daemon with the FakeRuntime; `listen` can be called again on the same port. Its
 * history index reads `historyRoot` (a fake `~/.claude/projects`); call `history.scan()` after
 * writing transcripts there.
 */
export function daemon(
  cleanups: Array<() => unknown>,
  options: { allowApiKey?: boolean; baseEnv?: Record<string, string> } = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fd-desk-")));
  const project = join(root, "p");
  mkdirSync(project);
  const store = new EventStore(":memory:");
  const historyRoot = join(root, "claude-projects");
  mkdirSync(historyRoot);
  const history = new HistoryIndexer({ db: store.db, roots: [historyRoot] });
  const runtime = new FakeRuntime({ delayMs: 1 });
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: options.allowApiKey ?? false,
    baseEnv: options.baseEnv ?? {},
  });
  const listen = (port = 0, pingIntervalMs?: number): RunningServer => {
    const server = startServer({
      ...(pingIntervalMs ? { pingIntervalMs } : {}),
      manager,
      history,
      hostName: "h1",
      bind: "127.0.0.1",
      port,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    return server;
  };
  return { manager, project, root, listen, history, historyRoot, runtime };
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
    Notification: Object.assign(
      function (this: unknown, title: string, options?: { body?: string }) {
        notifications.push({ title, body: options?.body ?? "" });
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
  return { platform, items, tokens, notifications, win, deepLink };
}
