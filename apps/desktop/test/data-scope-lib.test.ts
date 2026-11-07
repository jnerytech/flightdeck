import { describe, expect, test } from "bun:test";
import {
  ALL_SCOPE,
  activeScope,
  DATA_SCOPE_KEY,
  DataScopeController,
  parseScope,
  scopeHosts,
} from "../src/lib/data-scope.ts";

/** A storage in memory; `refuse` makes every call throw, like a private window's. */
function storage(initial: Record<string, string> = {}, refuse = false) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => {
      if (refuse) throw new Error("no storage");
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (refuse) throw new Error("no storage");
      items.set(key, value);
    },
    removeItem: (key: string) => void items.delete(key),
  };
}

const HOSTS = [{ id: "a" }, { id: "b" }];

describe("data-scope: whose data the scoped screens show (#126)", () => {
  test("kept as JSON; anything unreadable is every host", () => {
    expect([
      parseScope('{"kind":"host","hostId":"a"}'),
      parseScope('{"kind":"all"}'),
      parseScope(null),
      parseScope("not json"),
      parseScope('{"kind":"host"}'),
      parseScope('{"kind":"project","hostId":"a"}'),
    ]).toEqual([
      { kind: "host", hostId: "a" },
      ALL_SCOPE,
      ALL_SCOPE,
      ALL_SCOPE,
      ALL_SCOPE,
      ALL_SCOPE,
    ]);
  });

  test("a host that is no longer there means every host; one that is there stays, online or not", () => {
    expect([
      activeScope({ kind: "host", hostId: "b" }, HOSTS),
      activeScope({ kind: "host", hostId: "gone" }, HOSTS),
      activeScope(ALL_SCOPE, HOSTS),
    ]).toEqual([{ kind: "host", hostId: "b" }, ALL_SCOPE, ALL_SCOPE]);
  });

  test("the hosts it keeps, in their order", () => {
    expect([
      scopeHosts(HOSTS, ALL_SCOPE).map((h) => h.id),
      scopeHosts(HOSTS, { kind: "host", hostId: "b" }).map((h) => h.id),
    ]).toEqual([["a", "b"], ["b"]]);
  });

  test("the controller reads the kept scope, keeps a new one and tells its listeners", () => {
    const kept = storage({ [DATA_SCOPE_KEY]: '{"kind":"host","hostId":"a"}' });
    const scope = new DataScopeController(kept);
    const first = scope.value;
    let told = 0;
    const stop = scope.subscribe(() => told++);
    scope.set({ kind: "host", hostId: "b" });
    stop();
    scope.set(ALL_SCOPE);
    expect({ first, now: scope.value, told, stored: kept.items.get(DATA_SCOPE_KEY) }).toEqual({
      first: { kind: "host", hostId: "a" },
      now: ALL_SCOPE,
      told: 1,
      stored: '{"kind":"all"}',
    });
  });

  test("a storage that refuses: every host at start, and a change still applies", () => {
    const scope = new DataScopeController(storage({}, true));
    const first = scope.value;
    scope.set({ kind: "host", hostId: "a" });
    expect({ first, now: scope.value }).toEqual({
      first: ALL_SCOPE,
      now: { kind: "host", hostId: "a" },
    });
  });
});
