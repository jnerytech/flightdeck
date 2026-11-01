import { type KnownProject, resolveClient } from "./client-rules.ts";
import { type Client, type ClientColor, type ClientsData, UNASSIGNED } from "./clients.ts";

/** Where the selected client is kept between starts. */
export const CLIENT_SELECTION_KEY = "flightdeck.clientFilter";

/** The selection that shows everything. */
export const ALL_CLIENTS = "all";

/** The selection kept in storage, or "all" when it names a client that is gone. */
export function loadSelection(
  storage: { getItem(key: string): string | null },
  clients: Client[],
): string {
  const stored = storage.getItem(CLIENT_SELECTION_KEY);
  if (stored === null || clients.length === 0) return ALL_CLIENTS;
  const valid = stored === UNASSIGNED || clients.some((c) => c.id === stored);
  return valid ? stored : ALL_CLIENTS;
}

export function saveSelection(
  storage: { setItem(key: string, value: string): void },
  selection: string,
): void {
  storage.setItem(CLIENT_SELECTION_KEY, selection);
}

/** A host as the scope needs it: its id and the names a project key may carry for it. */
export interface ScopeHost {
  id: string;
  names: string[];
}

/** A folder key (`host:<name>:<folder>`) is named after the daemon's host, not the app's host id. */
const FOLDER_KEY = /^host:([^:]+):(.+)$/;

/** Which client each project belongs to right now, and what that means for a selection. */
export class ClientScope {
  private readonly projects: Map<string, KnownProject>;
  private readonly hostByName: Map<string, string>;
  private readonly resolved = new Map<string, string>();

  constructor(
    private readonly data: Pick<ClientsData, "clients" | "overrides">,
    projects: KnownProject[],
    hosts: ScopeHost[] = [],
  ) {
    this.projects = new Map(projects.map((p) => [p.key, p]));
    this.hostByName = new Map(hosts.flatMap((h) => h.names.map((name) => [name, h.id] as const)));
  }

  /** Whether any client exists; with none the screens show everything and no chips. */
  get active(): boolean {
    return this.data.clients.length > 0;
  }

  /** The project as the rules see it: a folder key also names its folder on the host's id. */
  private known(key: string): KnownProject {
    const base = this.projects.get(key) ?? { key, cwds: [] };
    const named = FOLDER_KEY.exec(key);
    const hostId = named?.[1] ? this.hostByName.get(named[1]) : undefined;
    return hostId && named?.[2] ? { key, cwds: [...base.cwds, { hostId, path: named[2] }] } : base;
  }

  clientOf(projectKey: string): string {
    let id = this.resolved.get(projectKey);
    if (id === undefined) {
      id = resolveClient(this.known(projectKey), this.data).clientId;
      this.resolved.set(projectKey, id);
    }
    return id;
  }

  includes(selection: string, projectKey: string): boolean {
    return selection === ALL_CLIENTS || this.clientOf(projectKey) === selection;
  }

  filter<T>(items: readonly T[], selection: string, keyOf: (item: T) => string): T[] {
    return items.filter((item) => this.includes(selection, keyOf(item)));
  }

  /** The client's name and color for a chip; null with no client, or for Unassigned. */
  chipOf(projectKey: string): { id: string; name: string; color: ClientColor } | null {
    const id = this.clientOf(projectKey);
    const found = this.data.clients.find((c) => c.id === id);
    return found ? { id: found.id, name: found.name, color: found.color } : null;
  }
}
