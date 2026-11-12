import type { KnownProject } from "./client-rules-model.ts";
import { ALL_CLIENTS, ClientScope, saveSelection } from "./client-scope.ts";
import { type Client, UNASSIGNED } from "./clients.ts";

/** The part of the app's state that tells which client each project belongs to. */
export interface ClientScopeState {
  hosts: ReadonlyArray<{ id: string; name: string; hostInfo: { hostName?: string } | null }>;
  clientList: Client[];
  clientOverrides: Record<string, string | null>;
  clientSelection: string;
}

/** What the client scope reads and does through the app's store. */
export interface ClientScopeCore {
  /** The app's state: the same object for as long as nothing in it changed. */
  state(): ClientScopeState;
  update(
    patch: Partial<Pick<ClientScopeState, "clientList" | "clientOverrides" | "clientSelection">>,
  ): void;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** The clients the person kept, and the projects they were moved to by hand. */
  clients(): { list(): Client[]; overrides(): Record<string, string | null> };
  /** The projects the rows and the project lists show now, with the folders they have on each host. */
  projects(): KnownProject[];
  /** The clients changed: what depends on their rules and limits looks again. */
  changed(): void;
}

/**
 * Which client the person works for (#1596: a slice of the store): the selection the work screens
 * filter by, kept across starts, and the client of each project, worked out once for each state.
 */
export class ClientScopeSlice {
  private memo: { state: ClientScopeState; scope: ClientScope } | null = null;

  constructor(private readonly core: ClientScopeCore) {}

  /** A client was changed: the screens read the new list, and a selection that is gone is all. */
  sync(): void {
    const clients = this.core.clients();
    const clientList = clients.list();
    const kept = this.core.state().clientSelection;
    const valid = this.exists(kept, clientList);
    if (!valid) saveSelection(this.core.storage, ALL_CLIENTS);
    this.core.update({
      clientList,
      clientOverrides: clients.overrides(),
      clientSelection: valid ? kept : ALL_CLIENTS,
    });
    this.core.changed();
  }

  /** What the work screens show: all clients, Unassigned or one client; a name nobody has is refused. */
  select(selection: string): void {
    if (!this.exists(selection, this.core.state().clientList)) return;
    saveSelection(this.core.storage, selection);
    this.core.update({ clientSelection: selection });
  }

  /** The shortcut: the next client in the switcher's order (all, each client, Unassigned), then all again. */
  next(): void {
    const { clientList, clientSelection } = this.core.state();
    if (clientList.length === 0) return;
    const order = [ALL_CLIENTS, ...clientList.map((c) => c.id), UNASSIGNED];
    const at = order.indexOf(clientSelection);
    this.select(order[(at + 1) % order.length] ?? ALL_CLIENTS);
  }

  /** Which client each project belongs to, from the rows and projects the app has now. */
  get(): ClientScope {
    const state = this.core.state();
    if (this.memo?.state === state) return this.memo.scope;
    const { hosts, clientList, clientOverrides } = state;
    const scope = new ClientScope(
      { clients: clientList, overrides: clientOverrides },
      this.core.projects(),
      hosts.map((h) => ({
        id: h.id,
        names: h.hostInfo?.hostName ? [h.name, h.hostInfo.hostName] : [h.name],
      })),
    );
    this.memo = { state, scope };
    return scope;
  }

  /** Whether the selection is all, or a client the person has (Unassigned only while there are clients). */
  private exists(selection: string, clients: Client[]): boolean {
    return (
      selection === ALL_CLIENTS ||
      (clients.length > 0 && (selection === UNASSIGNED || clients.some((c) => c.id === selection)))
    );
  }
}
