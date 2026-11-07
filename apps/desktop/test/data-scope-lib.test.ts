import { describe, expect, test } from "bun:test";
import {
  ALL_SCOPE,
  activeScope,
  awayKey,
  DATA_SCOPE_KEY,
  DataScopeController,
  parseScope,
  scopeHosts,
  scopeOfValue,
  scopeValue,
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
      parseScope('{"kind":"host","hostId":""}'),
      parseScope("null"),
      parseScope("5"),
    ]).toEqual([
      { kind: "host", hostId: "a" },
      ALL_SCOPE,
      ALL_SCOPE,
      ALL_SCOPE,
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

  // Review of #837: before the host list is read, a kept host is not "gone" yet. Falling back
  // then would ask every host for the numbers the person chose not to see.
  test("before the host list is read, a kept host stays the scope", () => {
    expect([
      activeScope({ kind: "host", hostId: "a" }, [], false),
      activeScope({ kind: "host", hostId: "a" }, [], true),
      activeScope(ALL_SCOPE, [], false),
    ]).toEqual([{ kind: "host", hostId: "a" }, ALL_SCOPE, ALL_SCOPE]);
  });

  // Review of #837: the menu's value for every host is not a value any host id can take.
  test("a menu value names one scope, and no host id is the value for every host", () => {
    const ids = ["a", "all", "*", "host:x"];
    const values = [ALL_SCOPE, ...ids.map((hostId) => ({ kind: "host", hostId }) as const)].map(
      scopeValue,
    );
    expect({
      distinct: new Set(values).size,
      back: values.map(scopeOfValue),
      unknown: scopeOfValue("nonsense"),
    }).toEqual({
      distinct: 5,
      back: [ALL_SCOPE, ...ids.map((hostId) => ({ kind: "host" as const, hostId }))],
      unknown: ALL_SCOPE,
    });
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

// #886: the notice says why the scoped host shows nothing, in what the screen lists.
describe("data-scope: why a scoped host has nothing to show", () => {
  test("an incompatible daemon needs an update; any other host is offline, numbers or sessions", () => {
    expect([
      awayKey("incompatible", "numbers"),
      awayKey("incompatible", "sessions"),
      awayKey("offline", "numbers"),
      awayKey("offline", "sessions"),
      awayKey("unauthorized", "sessions"),
    ]).toEqual([
      "scope.incompatible",
      "scope.incompatible",
      "scope.offline",
      "scope.offlineSessions",
      "scope.offlineSessions",
    ]);
  });
});
