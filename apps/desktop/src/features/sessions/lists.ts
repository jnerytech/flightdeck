import type {
  BgList,
  ExternalSession,
  HistorySessionSummary,
  SessionMeta,
  SessionSummary,
} from "@flightdeck/protocol";
import type { AppState, HostView } from "../../lib/app-store.ts";
import type { HostConnection } from "../../lib/host-connection.ts";
import { hasFeature } from "../../lib/version.ts";
import { sessionKey } from "./session-key.ts";

/** Sessions shown by the per-host history list (the newest ones; filters narrow it down). */
export const HISTORY_LIST_LIMIT = 200;

type ListsState = Pick<AppState, "hosts" | "hub" | "names" | "meta" | "externals">;
type ListsPatch = Partial<Pick<AppState, "hub" | "names" | "meta" | "externals" | "background">>;

/** Whether two values hold the same data (the answers of a host are plain JSON). */
const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A request whose failure only means less to show (an older daemon, a host without history). */
const quiet = <T>(promise: Promise<T>) => promise.catch(() => null);

/** What the session lists read and ask through the app's store. */
export interface SessionListsCore {
  /** What the app holds about the hosts and the lists the screens show. */
  state(): ListsState;
  /** Changes what the app holds, as one change. */
  patch(patch: ListsPatch): void;
  /** A host's connection; nothing when the host is not known. */
  connection(hostId: string): HostConnection | undefined;
  /** What the state needs to hold a background list the poll read: nothing when it is the same. */
  backgroundPatch(hostId: string, list: BgList): ListsPatch | null;
}

/**
 * What the Sessions screen lists from the online hosts (#1596: a slice of the store): the managed
 * and the history sessions, the names a host gives, the terminal sessions and the background ones.
 * A list is folded into the state only when it differs from the one held, so a poll that finds the
 * same lists tells nobody (the screens compare by reference).
 */
export class SessionListsSlice {
  constructor(private readonly core: SessionListsCore) {}

  /**
   * Loads what the Sessions screen lists from every online host. Quiet: a host without history or
   * hub (older daemon) just contributes less.
   */
  async refresh(): Promise<void> {
    await Promise.all(
      this.core
        .state()
        .hosts.filter((host) => host.status === "online")
        .map((host) => this.refreshHost(host)),
    );
  }

  /** The session lists of one online host, read and folded into the state when they changed. */
  private async refreshHost(host: HostView): Promise<void> {
    const conn = this.core.connection(host.id) as HostConnection;
    const named = hasFeature(host.hostInfo?.features, "names", false);
    const withBackground = hasFeature(host.hostInfo?.features, "bg", false);
    const [managed, history, external, standard, background] = await Promise.all([
      quiet(conn.request("session.list", {})),
      quiet(conn.request("history.list", { limit: HISTORY_LIST_LIMIT })),
      quiet(conn.request("external.list", {})),
      named ? quiet(conn.request("names.list", {})) : null,
      withBackground ? quiet(conn.request("bg.list", {})) : null,
    ]);
    const state = this.core.state();
    const patch: ListsPatch = this.changedMeta(host.id, managed, history, external);
    // A request that failed (`null`: a busy host, a timeout) says nothing about the list, so
    // the one the state holds stays; an empty answer is the only way a list empties.
    const before = state.hub[host.id];
    const lists = {
      managed: managed ? managed.sessions : (before?.managed ?? []),
      history: history ? history.sessions : (before?.history ?? []),
    };
    const standardNames = standard ? standard.names : (state.names[host.id] ?? []);
    if (!sameJson(state.hub[host.id], lists)) {
      patch.hub = { ...state.hub, [host.id]: lists };
    }
    if (!sameJson(state.names[host.id], standardNames)) {
      patch.names = { ...state.names, [host.id]: standardNames };
    }
    Object.assign(patch, background && this.core.backgroundPatch(host.id, background));
    if (Object.keys(patch).length > 0) this.core.patch(patch);
  }

  /**
   * The `meta` and `externals` of the state with what the lists say, each only when it differs from
   * what the state holds.
   */
  private changedMeta(
    hostId: string,
    managed: { sessions: Array<Pick<SessionSummary, "claudeSessionId" | "meta">> } | null,
    history: { sessions: Array<Pick<HistorySessionSummary, "claudeSessionId" | "meta">> } | null,
    external: { sessions: ExternalSession[] } | null,
  ): ListsPatch {
    const state = this.core.state();
    const meta = { ...state.meta };
    const externals = { ...state.externals };
    let metaChanged = false;
    let externalsChanged = false;
    const putMeta = (key: string, value: SessionMeta) => {
      if (sameJson(meta[key], value)) return;
      meta[key] = value;
      metaChanged = true;
    };
    for (const s of [...(managed?.sessions ?? []), ...(history?.sessions ?? [])]) {
      if (s.claudeSessionId && s.meta) putMeta(sessionKey(hostId, s.claudeSessionId), s.meta);
    }
    for (const s of external?.sessions ?? []) {
      const key = sessionKey(hostId, s.claudeSessionId);
      // A list read before a hook but answered after its frame is older than what the
      // frame put in the state: it must not undo it.
      const held = externals[key];
      const older = held !== undefined && Date.parse(s.lastEventAt) < Date.parse(held.lastEventAt);
      if (!older && !sameJson(held, s)) {
        externals[key] = s;
        externalsChanged = true;
      }
      if (s.meta) putMeta(key, s.meta);
    }
    return {
      ...(metaChanged ? { meta } : {}),
      ...(externalsChanged ? { externals } : {}),
    };
  }
}
