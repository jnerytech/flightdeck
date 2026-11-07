import type { CostsSummary, UsageSummary } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";
import type { HomeCosts, HomeUsage } from "./home-kpis.ts";

const KEY = "flightdeck.home.v1";
/** What a project's entry carries after its hosts (#126 slice 4). */
const PROJECT_ENTRY = "|project:";
/** How many host sets and periods are kept: the newest ones. */
const MAX_ENTRIES = 8;

/** What Home last read from one host: only numbers (no project, title or folder) and when. */
export interface HomeHostData {
  /** When the numbers were read, in milliseconds. */
  at: number;
  costs: HomeCosts | null;
  usage: HomeUsage | null;
}

/** The numbers of every host of a set, by host id. */
export type HomeSnapshot = Record<string, HomeHostData>;

/** One entry per period and set of hosts: the same hosts in another order are the same entry. */
export const homeKey = (period: string, hostIds: string[], projectKey?: string): string =>
  `${period}|${[...hostIds].sort((a, b) => a.localeCompare(b)).join(",")}${
    // A project's numbers are an entry of their own (#126 slice 4).
    projectKey ? `${PROJECT_ENTRY}${projectKey}` : ""
  }`;

/** The numbers Home draws from a host's answers, and nothing else of what the host sent. */
export function homeHostData(
  costs: CostsSummary | null,
  usage: UsageSummary | null,
  at: number,
  /** With a project scope (#126 slice 4), only its usage rows: costs come filtered by the host. */
  projectKey?: string,
): HomeHostData {
  return {
    at,
    costs: costs && {
      totals: { tokens: costs.totals.tokens },
      byDay: costs.byDay.map(({ day, costUsd, tokens }) => ({ day, costUsd, tokens })),
    },
    usage: usage && {
      rows: usage.rows
        .filter((row) => !projectKey || row.projectKey === projectKey)
        .map(({ day, costUsd, turns, failedTurns, durationMs }) => ({
          day,
          costUsd,
          turns,
          ...(failedTurns === undefined ? {} : { failedTurns }),
          ...(durationMs === undefined ? {} : { durationMs }),
        })),
    },
  };
}

/** Whether what came from the storage has the shape of a host's numbers. */
const isHostData = (value: unknown): value is HomeHostData => {
  const host = value as Partial<HomeHostData> | null;
  return (
    typeof host?.at === "number" &&
    (host.costs === null || typeof host.costs === "object") &&
    (host.usage === null || typeof host.usage === "object")
  );
};

/** The stored entries; whatever is damaged or not a host's numbers is left out. */
function read(storage: Platform["storage"]): Record<string, HomeSnapshot> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "{}");
    return Object.fromEntries(
      Object.entries((parsed ?? {}) as Record<string, Record<string, unknown>>).map(
        ([key, hosts]) => [
          key,
          Object.fromEntries(Object.entries(hosts).filter(([, host]) => isHostData(host))),
        ],
      ),
    ) as Record<string, HomeSnapshot>;
  } catch {
    return {};
  }
}

/**
 * Home's last numbers per period and set of hosts, in memory and in the app's local storage, so
 * the page shows them at once and reads again in the background (issue #607).
 */
export class HomeCache {
  private entries: Record<string, HomeSnapshot>;

  constructor(private readonly storage: Platform["storage"]) {
    this.entries = read(storage);
  }

  get(key: string): HomeSnapshot | undefined {
    return this.entries[key];
  }

  set(key: string, snapshot: HomeSnapshot): void {
    const newest = (hosts: HomeSnapshot) => Math.max(0, ...Object.values(hosts).map((h) => h.at));
    this.entries = Object.fromEntries(
      Object.entries({ ...this.entries, [key]: snapshot })
        .sort(([, a], [, b]) => newest(b) - newest(a))
        .slice(0, MAX_ENTRIES),
    );
    // A project's entry names the project (its key can hold a host and a path): memory only, as the
    // leaderboard is (#124, review of #917).
    const kept = Object.fromEntries(
      Object.entries(this.entries).filter(([entry]) => !entry.includes(PROJECT_ENTRY)),
    );
    try {
      this.storage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // A full or refused storage: the numbers stay in memory.
    }
  }
}
