import { afterEach, describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import {
  ALL_SCOPE,
  DATA_SCOPE_KEY,
  DataScopeController,
  hubHostScope,
} from "../src/lib/data-scope.ts";
import { HOSTS_KEY } from "../src/lib/hosts.ts";
import { HUB_FILTER_KEY, takeHubHost } from "../src/lib/hub.ts";
import { memoryPlatform } from "./fixtures.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const HOSTS = [
  { id: "h1", name: "alfa" },
  { id: "h2", name: "beta" },
];

/** A storage in memory, as the platform's. */
function storage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

describe("hub-scope: the hub's own host filter becomes the data scope, once (#126)", () => {
  test("the hub kept a host's name: it stands for that host, and an unknown name for every host", () => {
    expect([
      hubHostScope("beta", HOSTS),
      hubHostScope("", HOSTS),
      hubHostScope("gone", HOSTS),
    ]).toEqual([{ kind: "host", hostId: "h2" }, ALL_SCOPE, ALL_SCOPE]);
  });

  test("the host is taken out of the hub's kept filter, and the other filters stay", () => {
    const kept = storage({
      [HUB_FILTER_KEY]: JSON.stringify({ host: "beta", origin: "terminal", pinnedOnly: true }),
    });
    const taken = takeHubHost(kept);
    const again = takeHubHost(kept);
    const left = JSON.parse(kept.items.get(HUB_FILTER_KEY) ?? "{}") as Record<string, unknown>;
    expect({
      taken,
      again,
      host: "host" in left,
      origin: left.origin,
      pinned: left.pinnedOnly,
    }).toEqual({ taken: "beta", again: "", host: false, origin: "terminal", pinned: true });
  });

  test("nothing kept, or not readable, takes nothing", () => {
    expect([
      takeHubHost(storage()),
      takeHubHost(storage({ [HUB_FILTER_KEY]: "not json" })),
    ]).toEqual(["", ""]);
  });

  test("a scope is chosen once one is kept, not before", () => {
    const fresh = new DataScopeController(storage());
    const before = fresh.chosen;
    fresh.set(ALL_SCOPE);
    const kept = new DataScopeController(storage({ [DATA_SCOPE_KEY]: '{"kind":"all"}' }));
    expect({ before, after: fresh.chosen, kept: kept.chosen }).toEqual({
      before: false,
      after: true,
      kept: true,
    });
  });

  /** A store whose saved hosts are alfa and beta, with no token: none connects. */
  async function started(items: Record<string, string>) {
    const mem = memoryPlatform(false, "en");
    mem.platform.storage.setItem(
      HOSTS_KEY,
      JSON.stringify(HOSTS.map((h) => ({ ...h, url: "ws://x" }))),
    );
    for (const [key, value] of Object.entries(items)) mem.platform.storage.setItem(key, value);
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    cleanups.push(() => store.dispose());
    await store.init();
    return { store, storage: mem.platform.storage };
  }

  test("at start, the hub's host becomes the scope when none was chosen, and leaves the hub", async () => {
    const { store, storage: kept } = await started({
      [HUB_FILTER_KEY]: JSON.stringify({ host: "beta", state: "running" }),
    });
    const left = JSON.parse(kept.getItem(HUB_FILTER_KEY) ?? "{}") as Record<string, unknown>;
    expect({ scope: store.dataScope.value, host: "host" in left, state: left.state }).toEqual({
      scope: { kind: "host", hostId: "h2" },
      host: false,
      state: "running",
    });
  });

  test("at start, a scope already chosen wins over the hub's old host, which still leaves", async () => {
    const { store, storage: kept } = await started({
      [DATA_SCOPE_KEY]: '{"kind":"host","hostId":"h1"}',
      [HUB_FILTER_KEY]: JSON.stringify({ host: "beta" }),
    });
    const left = JSON.parse(kept.getItem(HUB_FILTER_KEY) ?? "{}") as Record<string, unknown>;
    expect({ scope: store.dataScope.value, host: "host" in left }).toEqual({
      scope: { kind: "host", hostId: "h1" },
      host: false,
    });
  });
});
