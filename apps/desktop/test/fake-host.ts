import { afterEach } from "bun:test";
import type { AppStore } from "../src/lib/app-store.ts";
import { memoryPlatform, seedHosts } from "./fixtures.ts";

/** The commands a fake host got with no handler and no `fallback`: the test fails after it, naming them. */
const unhandled: string[] = [];
afterEach(() => {
  const left = unhandled.splice(0);
  if (left.length > 0) {
    throw new Error(
      `the fake host got commands no handler answers: ${[...new Set(left)].join(", ")}`,
    );
  }
});

/** What a fake host does with a command: its answer, or a promise of it. */
export type HostHandler = (payload: never) => unknown;

/**
 * A real `AppStore` over a fake host (#1870): the store, its slices and the screens on it run as
 * they do in the app, and only the host's end of the wire is faked. Each command goes to the
 * handler of its type; one with no handler fails the test unless `fallback` is given. The calls are kept in
 * order. Load it after `registerDom()`: the store reads the DOM when it is imported. `platform` is
 * the store's own, the other seam a test may replace (the vault, the clipboard, the updater).
 */
export async function fakeHostStore(
  handlers: Record<string, HostHandler> = {},
  options: {
    hostId?: string;
    features?: string[];
    fallback?: unknown;
    language?: string;
    /** Names of vault secrets the store holds, each allowed on the fake host. */
    secrets?: string[];
  } = {},
) {
  const { AppStore: Store } = await import("../src/lib/app-store.ts");
  const hostId = options.hostId ?? "h";
  const { platform } = memoryPlatform(false, options.language ?? "pt-BR");
  const store: AppStore = new Store(platform);
  seedHosts(store, [{ id: hostId, name: "alfa", features: options.features ?? [] }]);
  const calls: Array<{ type: string; payload: unknown }> = [];
  const connection = {
    request: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      const handler = handlers[type];
      if (handler) return handler(payload as never);
      // A missing handler is a hole in the test, not an answer: only a given `fallback` stands in.
      if (!("fallback" in options)) unhandled.push(type);
      return options.fallback ?? null;
    },
    dispose: () => {},
  };
  // The only private thing a test touches: the host's end of the wire is the one that is faked.
  (store as unknown as { connections: Map<string, unknown> }).connections.set(hostId, connection);
  // What the store does when a host that announces vault actions connects.
  if ((options.features ?? []).includes("actions")) {
    store.vaultRules.onConnect(hostId, connection as never);
  }
  // Created through the store, as the Vault screen does; a host takes the secrets it is allowed.
  const secretIds: string[] = [];
  for (const name of options.secrets ?? []) {
    const meta = await store.secrets.add({
      name,
      type: "token",
      value: "v",
      allowedHosts: [hostId],
    });
    secretIds.push(meta.id);
  }
  return { store, hostId, calls, secretIds, platform };
}

/**
 * A handler over a pending call whose answer may be an `Error`: the host refuses on the wire, as a
 * daemon does (an ack that is not ok), and the store turns it into the refusal a screen shows.
 */
export function onWire(call: (payload: unknown) => Promise<unknown>): HostHandler {
  return async (payload) => {
    const answer = await call(payload);
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

/**
 * Puts a test between a real store and its real host (#1870): every command goes through
 * `intercept`, which answers it, makes it fail or waits, and calls `next()` for the host's own
 * answer. This is the one place a test breaks the wire, instead of replacing a method of the store
 * (`hostCommand`, `terminals.host`). Returns the call that puts the wire back.
 */
export function interceptWire(
  store: AppStore,
  hostId: string,
  intercept: (type: string, payload: unknown, next: () => Promise<unknown>) => Promise<unknown>,
): () => void {
  const connections = (store as unknown as { connections: Map<string, WireEnd> }).connections;
  const end = connections.get(hostId);
  if (!end) throw new Error(`no connection to ${hostId}: add the host first`);
  const real = end.request;
  end.request = (type, payload) => intercept(type, payload, () => real.call(end, type, payload));
  return () => {
    end.request = real;
  };
}

interface WireEnd {
  request(type: string, payload: unknown): Promise<unknown>;
}
