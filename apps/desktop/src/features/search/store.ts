import type { HistorySearchHit, HistorySearchResult } from "@flightdeck/protocol";

export interface GlobalHit extends HistorySearchHit {
  hostId: string;
  hostName: string;
}

export interface SearchState {
  query: string;
  /** Every host's hits so far, newest first. */
  hits: GlobalHit[];
  /** Hosts still being asked. */
  waiting: string[];
  /** Hosts that were offline or did not answer in time. */
  silent: string[];
}

/** The global history search's part of the app's state (#1596). */
export interface SearchSliceState {
  /** Last global history search, `null` before the first one. */
  search: SearchState | null;
  searchOpen: boolean;
}

export const initialSearchState: SearchSliceState = { search: null, searchOpen: false };

/** What the search reads and writes through the app's store: its state, the hosts, their links. */
export interface SearchCore {
  state(): SearchSliceState & {
    hosts: ReadonlyArray<{ id: string; name: string; status: string }>;
  };
  update(patch: Partial<SearchSliceState>): void;
  /** A host's `history.search`; absent when the host has no connection. */
  request(hostId: string, query: string): Promise<HistorySearchResult> | undefined;
  /** How long the search waits for each host. */
  timeoutMs: number;
}

/** Rejects when `promise` (absent when the host has no connection) takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T> | undefined, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("no answer")), ms);
  });
  return Promise.race([promise ?? Promise.reject(new Error("no connection")), timeout]).finally(
    () => clearTimeout(timer),
  );
}

/** The global history search over every host (#1596: the first slice of the app's store). */
export class SearchSlice {
  private searchSeq = 0;

  constructor(private readonly core: SearchCore) {}

  open(): void {
    this.core.update({ searchOpen: true });
  }

  close(): void {
    this.core.update({ searchOpen: false });
  }

  /**
   * Asks every online host at once and merges the hits by date as they arrive. Offline hosts are
   * reported right away; a host that does not answer within `searchTimeoutMs` is reported too.
   */
  async history(query: string): Promise<void> {
    if (!query.trim()) return;
    const token = ++this.searchSeq;
    const hosts = this.core.state().hosts;
    const online = hosts.filter((h) => h.status === "online");
    // An incompatible host is out of every list, so it is not reported as silent either.
    const offline = hosts
      .filter((h) => h.status !== "online" && h.status !== "incompatible")
      .map((h) => h.id);
    this.core.update({
      search: { query, hits: [], waiting: online.map((h) => h.id), silent: offline },
    });
    const timeoutMs = this.core.timeoutMs;
    await Promise.all(
      online.map(async (host) => {
        const request = this.core.request(host.id, query);
        const result = await withTimeout(request, timeoutMs).catch(() => null);
        // A newer search replaced this one.
        if (token !== this.searchSeq) return;
        const search = this.core.state().search as SearchState;
        const waiting = search.waiting.filter((id) => id !== host.id);
        if (!result) {
          this.core.update({ search: { ...search, waiting, silent: [...search.silent, host.id] } });
          return;
        }
        const hits = [
          ...search.hits,
          ...result.hits.map((hit) => ({ ...hit, hostId: host.id, hostName: host.name })),
        ].sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
        this.core.update({ search: { ...search, waiting, hits } });
      }),
    );
  }
}
