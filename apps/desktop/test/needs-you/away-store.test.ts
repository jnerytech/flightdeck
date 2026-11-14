import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AWAY_KEY } from "../../src/features/needs-you/domain/away.ts";
import { daemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { settle } from "../wait.ts";

const { AppStore } = await import("../../src/lib/app-store.ts");

setDefaultTimeout(30_000);

/**
 * Issue #1344: "While you were away". The store asks each host with the feature what happened
 * since the app was last active, once the absence was long enough, and keeps it for Needs you.
 */
const NOW = Date.parse("2026-11-09T08:00:00.000Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function start(
  options: { away?: number | null; features?: string[]; withActivity?: boolean } = {},
) {
  const mem = memoryPlatform(false, "en");
  if (options.away !== null) mem.items.set(AWAY_KEY, iso(NOW - (options.away ?? 8 * HOUR)));
  const d = daemon(cleanups, { activity: options.withActivity !== false });
  const db = d.eventStore.db;
  for (const [id, ended] of [
    ["s1", NOW - 2 * HOUR],
    ["s2", NOW - 1 * HOUR],
    ["old", NOW - 20 * HOUR],
  ] as const) {
    db.query(
      "INSERT INTO sessions (id, name, cwd, status, permission_mode, created_at, updated_at) VALUES (?, ?, '/r', 'ended', 'default', ?, ?)",
    ).run(id, id, iso(ended - HOUR), iso(ended));
  }
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000, now: () => NOW });
  cleanups.push(() => store.dispose());
  await store.roster.add({
    name: "alfa",
    url: d.listen(0, undefined, options.features).url,
    token: TOKEN,
  });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  return { store, mem, hostId: store.getState().hosts[0]?.id ?? "" };
}

describe("away-store (#1344)", () => {
  test("after a long absence each host with the feature says what happened since, on its own", async () => {
    const { store, hostId } = await start();
    // The host's info arriving is what asks it: nothing here calls loadAway.
    await settle(() => store.getState().away.hosts.length === 1);
    const away = store.getState().away;
    expect([
      away.since,
      away.hosts.map((h) => h.hostId),
      away.hosts[0]?.result.sessions.total,
      away.hosts[0]?.result.sessions.items.map((s) => s.id),
      away.dismissed,
    ]).toEqual([iso(NOW - 8 * HOUR), [hostId], 2, ["s2", "s1"], false]);
  });

  test("removing a host takes it out of the summary (#1733)", async () => {
    const { store, hostId } = await start();
    await settle(() => store.getState().away.hosts.length === 1);
    await store.roster.remove(hostId);
    const away = store.getState().away;
    expect([away.hosts, away.unreached]).toEqual([[], []]);
  });

  test("a host that does not announce the feature is left out", async () => {
    const { store } = await start({ features: [] });
    await store.activity.loadAway();
    const away = store.getState().away;
    expect([away.since, away.hosts, away.unreached]).toEqual([iso(NOW - 8 * HOUR), [], []]);
  });

  test("a host that announces the feature but does not answer is named in unreached, once", async () => {
    // It announces `activity` but has nothing wired, so the ask is refused.
    const { store, hostId } = await start({ features: ["activity"], withActivity: false });
    await settle(() => store.getState().away.unreached.length === 1);
    await store.activity.loadAway();
    const away = store.getState().away;
    expect([away.hosts, away.unreached]).toEqual([[], [hostId]]);
  });

  test("a short absence, or the first start, asks nothing and shows nothing", async () => {
    const short = await start({ away: 10 * 60_000 });
    await short.store.activity.loadAway();
    const first = await start({ away: null });
    await first.store.activity.loadAway();
    expect([short.store.getState().away, first.store.getState().away]).toEqual([
      { since: null, hosts: [], unreached: [], dismissed: false },
      { since: null, hosts: [], unreached: [], dismissed: false },
    ]);
  });

  test("closing the summary keeps it closed when it is asked again", async () => {
    const { store } = await start();
    await store.activity.loadAway();
    store.activity.dismissAway();
    await store.activity.loadAway();
    expect(store.getState().away.dismissed).toBe(true);
  });

  test("starting the app writes the time it is active, for the next start", async () => {
    const { store, mem } = await start({ away: null });
    await store.init();
    expect(mem.items.get(AWAY_KEY)).toBe(iso(NOW));
  });
});
