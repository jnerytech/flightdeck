import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeRuntime } from "../../daemon/src/runtime/fake-runtime.ts";
import { type RunningServer, startServer } from "../../daemon/src/server.ts";
import { SessionManager } from "../../daemon/src/sessions/session-manager.ts";
import { EventStore } from "../../daemon/src/store/event-store.ts";
import type { Platform } from "../src/lib/platform.ts";

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

/** In-process daemon with the FakeRuntime; `listen` can be called again on the same port. */
export function daemon(cleanups: Array<() => unknown>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fd-desk-")));
  const project = join(root, "p");
  mkdirSync(project);
  const manager = new SessionManager({
    store: new EventStore(":memory:"),
    runtime: new FakeRuntime({ delayMs: 1 }),
    allowedRoots: [root],
    defaultPermissionMode: "default",
    allowApiKey: false,
    baseEnv: {},
  });
  const listen = (port = 0): RunningServer => {
    const server = startServer({
      manager,
      hostName: "h1",
      bind: "127.0.0.1",
      port,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    return server;
  };
  return { manager, project, root, listen };
}

/** In-memory platform that records notifications. */
export function memoryPlatform(focused = false) {
  const items = new Map<string, string>();
  const tokens = new Map<string, string>();
  const notifications: Array<{ title: string; body: string }> = [];
  const platform: Platform = {
    storage: {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    },
    getToken: async (id) => tokens.get(id) ?? null,
    setToken: async (id, token) => {
      tokens.set(id, token);
    },
    deleteToken: async (id) => {
      tokens.delete(id);
    },
    notify: async (n) => {
      notifications.push(n);
    },
    isFocused: () => focused,
  };
  return { platform, items, tokens, notifications };
}
