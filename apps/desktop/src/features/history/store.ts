import type {
  CommandPayload,
  CommandResults,
  HistoryGetResult,
  HistoryListResult,
  HistorySearchHit,
  HistorySearchResult,
} from "@flightdeck/protocol";

/** What the slice sends on a host's connection: the store's `HostConnection` fits it. */
interface HistoryConnection {
  request<C extends "history.list" | "history.get" | "history.resume">(
    type: C,
    payload: CommandPayload<C>,
  ): Promise<CommandResults[C]>;
}

/** Filters of the per-host history list. */
export type HistoryFilter = Omit<CommandPayload<"history.list">, "cursor" | "limit">;

/** Messages per `history.get` page in the transcript reader. */
export const HISTORY_PAGE = 50;

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

/** The history's part of the app's state (#1596): for now, the global search over every host. */
export interface HistorySliceState {
  /** Last global history search, `null` before the first one. */
  search: SearchState | null;
  searchOpen: boolean;
}

export const initialHistoryState: HistorySliceState = { search: null, searchOpen: false };

/** What the search reads and writes through the app's store: its state, the hosts, their links. */
export interface HistoryCore {
  state(): HistorySliceState & {
    hosts: ReadonlyArray<{ id: string; name: string; status: string }>;
  };
  update(patch: Partial<HistorySliceState>): void;
  /** A host's `history.search`; absent when the host has no connection. */
  request(hostId: string, query: string): Promise<HistorySearchResult> | undefined;
  /** How long the search waits for each host. */
  timeoutMs(): number;
  /** A host's open connection, if it has one. */
  connection(hostId: string): HistoryConnection | undefined;
  /** Sessions shown by the per-host history list (the sessions domain's `HISTORY_LIST_LIMIT`). */
  listLimit: number;
  /** The connection's error for a host it does not know. */
  offline(): Error;
  /** Why a host refused a request, when `error` is the connection's refusal. */
  reason(error: unknown): string | undefined;
  /** Shows an error in the banner. */
  fail(error: unknown): void;
  /** Opens a session (a resumed transcript). */
  select(hostId: string, sessionId: string): void;
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

/** The history read from every host (#1596: the first slice of the app's store): its global search, each host's list and transcripts. */
export class HistorySlice {
  private searchSeq = 0;

  constructor(private readonly core: HistoryCore) {}

  openSearch(): void {
    this.core.update({ searchOpen: true });
  }

  closeSearch(): void {
    this.core.update({ searchOpen: false });
  }

  /**
   * Asks every online host at once and merges the hits by date as they arrive. Offline hosts are
   * reported right away; a host that does not answer within `searchTimeoutMs` is reported too.
   */
  async search(query: string): Promise<void> {
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
    const timeoutMs = this.core.timeoutMs();
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

  /** A host's indexed sessions; errors go to the banner and give `null`. */
  async list(hostId: string, filter: HistoryFilter): Promise<HistoryListResult | null> {
    try {
      const conn = this.core.connection(hostId);
      if (!conn) throw this.core.offline();
      return await conn.request("history.list", { ...filter, limit: this.core.listLimit });
    } catch (error) {
      this.core.fail(error);
      return null;
    }
  }

  /** One page of a host's transcript; errors go to the banner and give `null`. */
  async get(
    hostId: string,
    claudeSessionId: string,
    cursor?: string,
    tail = false,
    /** Told why a read was refused (issue #227): the reader tells "not found" from a failure. */
    refused?: (reason: string | undefined) => void,
  ): Promise<HistoryGetResult | null> {
    try {
      const conn = this.core.connection(hostId);
      if (!conn) throw this.core.offline();
      return await conn.request("history.get", {
        claudeSessionId,
        limit: HISTORY_PAGE,
        ...(cursor ? { cursor } : {}),
        ...(tail && !cursor ? { tail: true } : {}),
      });
    } catch (error) {
      const reason = this.core.reason(error);
      refused?.(reason);
      // Not indexed yet is a normal state (the indexer catches up), not something to tell the person.
      if (reason !== "transcript_not_indexed") {
        this.core.fail(error);
      }
      return null;
    }
  }

  /**
   * Continues an indexed transcript as a managed session and opens it. `force` is only sent after
   * the user confirmed a possibly-in-use session.
   */
  async resume(hostId: string, claudeSessionId: string, force: boolean): Promise<string | null> {
    try {
      const conn = this.core.connection(hostId);
      if (!conn) throw this.core.offline();
      const { sessionId } = await conn.request("history.resume", {
        claudeSessionId,
        ...(force ? { force: true } : {}),
      });
      this.core.select(hostId, sessionId);
      return sessionId;
    } catch (error) {
      this.core.fail(error);
      return null;
    }
  }
}
