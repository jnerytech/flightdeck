import { useEffect, useState } from "react";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { type HomeSnapshot, homeHostData } from "./domain/home-cache.ts";
import type { HomeLeaders } from "./domain/home-leaders.ts";
import { addUp, keepAnswers } from "./domain/home-view-model.ts";

/** The period the cards show; the cache keeps one entry for each period and set of hosts. */
export const PERIOD = "7d";

/** Read again every minute while the page is open, and when the window gets focus back. */
const REFRESH_MS = 60_000;

/** What the cards and the leaderboard need to read from one online host. */
interface ReadWindow {
  range: { from: string; to: string };
  days: string[];
  only: { projectKey?: string };
  projectKey: string | undefined;
}

/** One host's costs, usage and the leaderboard's two halves, and whether it answered. */
async function readHost(store: AppStore, host: HostView, span: ReadWindow) {
  const { range, days, only, projectKey } = span;
  const priced = hasFeature(host.hostInfo?.features, "costs", false);
  // The leaderboard's trend compares days 1-3 with days 4-6: today is not over.
  const half = (from: number, to: number) =>
    priced
      ? store.hostRequest(host.id, "costs.summary", {
          from: days[from] ?? range.from,
          to: days[to] ?? range.to,
          ...only,
        })
      : null;
  const [costs, usage, first, second] = await Promise.all([
    priced ? store.hostRequest(host.id, "costs.summary", { ...range, ...only }) : null,
    store.hostRequest(host.id, "usage.summary", { days: 7 }),
    half(0, 2),
    half(3, 5),
  ]);
  // A host that has costs but did not give them, or did not give its usage, did not answer.
  const answered = (costs === null || costs.ok) && usage.ok;
  return {
    id: host.id,
    priced,
    answered,
    // A host whose three costs came is in the leaderboard; the others are in the notices.
    shares:
      costs?.ok && first?.ok && second?.ok
        ? { week: costs.data, first: first.data, second: second.data }
        : null,
    data: homeHostData(
      costs?.ok ? costs.data : null,
      usage.ok ? usage.data : null,
      store.now(),
      projectKey,
    ),
  };
}

/** The last read of this visit: what it found, and which hosts answered. */
interface Fetched {
  entry: string;
  hosts: HomeSnapshot;
  answered: string[];
  /** Hosts of the set that had numbers from an earlier read. */
  kept: string[];
  /** Online hosts that did not answer. */
  failed: string[];
}

/** The leaderboard of the last read: in memory only, since it names projects (#124). */
// `leaders` is null after a read in which a host with costs did not give all of them.
interface Board {
  entry: string;
  leaders: HomeLeaders | null;
}

/**
 * Reads the online hosts for Home: at once, every minute and when the window comes back. The
 * numbers move with every turn.
 */
export function useHomeRead(
  store: AppStore,
  read: {
    online: HostView[];
    entry: string;
    key: string;
    span: ReadWindow;
    refreshMs: number | undefined;
  },
) {
  const { online, entry, key, span, refreshMs } = read;
  const { range } = span;
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [leaders, setLeaders] = useState<Board | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    const timer = setInterval(again, refreshMs ?? REFRESH_MS);
    window.addEventListener("focus", again);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, [refreshMs]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the hosts, the day or the tick change
  useEffect(() => {
    if (online.length === 0) return;
    let current = true;
    void Promise.all(online.map((host) => readHost(store, host, span))).then((results) => {
      if (!current) return;
      const before = store.homeCache.get(entry) ?? {};
      const hosts = keepAnswers(before, results);
      store.homeCache.set(entry, hosts);
      // The week names every project of the hosts that answered, not only the ones listed here:
      // the labels of every screen are told apart against them.
      const total = addUp(results, range);
      if (total.projectKeys) store.projectKeys.note(total.projectKeys);
      setLeaders((last) => nextBoard(last, entry, total));
      setFetched({
        entry,
        hosts,
        answered: results.filter((r) => r.answered).map((r) => r.id),
        kept: Object.keys(before),
        failed: results.filter((r) => !r.answered).map((r) => r.id),
      });
    });
    return () => {
      current = false;
    };
  }, [store, entry, key, range.from, range.to, tick]);

  return { fetched, leaders };
}

/**
 * The leaderboard after a read. Until every host with costs gave its three answers, the last whole
 * leaderboard of these hosts stays, or the panel says so.
 */
function nextBoard(
  last: Board | null,
  entry: string,
  total: { whole: boolean; leaders: HomeLeaders | null },
): Board {
  if (total.whole) return { entry, leaders: total.leaders };
  return last?.entry === entry && last.leaders ? last : { entry, leaders: null };
}
