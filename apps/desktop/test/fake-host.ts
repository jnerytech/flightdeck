import type { AppStore } from "../src/lib/app-store.ts";
import { memoryPlatform, seedHosts } from "./fixtures.ts";

/** What a fake host does with a command: its answer, or a promise of it. */
export type HostHandler = (payload: never) => unknown;

/**
 * A real `AppStore` over a fake host (#1870): the store, its slices and the screens on it run as
 * they do in the app, and only the host's end of the wire is faked. Each command goes to the
 * handler of its type; one with no handler is answered with `fallback`. The calls are kept in
 * order. Load it after `registerDom()`: the store reads the DOM when it is imported.
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
  const store: AppStore = new Store(memoryPlatform(false, options.language ?? "pt-BR").platform);
  seedHosts(store, [{ id: hostId, name: "alfa", features: options.features ?? [] }]);
  const calls: Array<{ type: string; payload: unknown }> = [];
  const connection = {
    request: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      const handler = handlers[type];
      return handler ? handler(payload as never) : (options.fallback ?? null);
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
  return { store, hostId, calls, secretIds };
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
