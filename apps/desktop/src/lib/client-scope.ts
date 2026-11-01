import { type KnownProject, resolveClient, ruleMatches } from "./client-rules.ts";
import {
  type Client,
  type ClientColor,
  type ClientsData,
  type RuleInput,
  UNASSIGNED,
} from "./clients.ts";
import { isInside } from "./paths.ts";

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
  private readonly hostsByName: Map<string, Set<string>>;
  private readonly resolved = new Map<string, string>();

  constructor(
    private readonly data: Pick<ClientsData, "clients" | "overrides">,
    projects: KnownProject[],
    hosts: ScopeHost[] = [],
  ) {
    this.projects = new Map(projects.map((p) => [p.key, p]));
    this.hostsByName = new Map();
    for (const host of hosts) {
      for (const name of host.names) {
        this.hostsByName.set(name, (this.hostsByName.get(name) ?? new Set()).add(host.id));
      }
    }
  }

  /** The host names that more than one host answers to; a folder key with one is not placed by host. */
  get ambiguousNames(): string[] {
    return [...this.hostsByName].filter(([, ids]) => ids.size > 1).map(([name]) => name);
  }

  /** The keys of the projects of a client, in order. */
  projectKeysOf(clientId: string): string[] {
    return this.knownProjects
      .map((p) => p.key)
      .filter((key) => this.clientOf(key) === clientId)
      .sort();
  }

  /** The projects the app knows, with the folders their sessions ran in. */
  get knownProjects(): KnownProject[] {
    return [...this.projects.values()];
  }

  /** The client by its id; null for Unassigned or an id that is gone. */
  client(id: string): Client | null {
    return this.data.clients.find((c) => c.id === id) ?? null;
  }

  /** The client a folder of a host belongs to: the project it is in, else the rules for a folder. */
  clientOfFolder(hostId: string, path: string): string {
    const holder = [...this.projects.values()].find((p) =>
      p.cwds.some((c) => c.hostId === hostId && isInside(path, c.path)),
    );
    if (holder) return this.clientOf(holder.key);
    // A folder no project is known in: only a folder rule can claim it.
    return resolveClient({ key: `host:?:${path}`, cwds: [{ hostId, path }] }, this.data).clientId;
  }

  /**
   * The persona the client of a folder opens sessions in, as a picker value (`host:<id>` or
   * `app:<id>`); with `idsOnly`, as the host's plain id, and only if it is a host's. "" for none.
   */
  defaultPersona(hostId: string, path: string, idsOnly = false): string {
    const persona = this.client(this.clientOfFolder(hostId, path))?.defaults.persona ?? "";
    if (!idsOnly) return persona;
    return persona.startsWith("host:") ? persona.slice("host:".length) : "";
  }

  /** The keys of the projects a rule would claim right now, for its preview. */
  matching(rule: RuleInput): string[] {
    return [...this.projects.keys()].filter((key) => ruleMatches(rule, this.known(key)));
  }

  /** Whether any client exists; with none the screens show everything and no chips. */
  get active(): boolean {
    return this.data.clients.length > 0;
  }

  /** The project as the rules see it: a folder key also names its folder on the host's id. */
  private known(key: string): KnownProject {
    const base = this.projects.get(key) ?? { key, cwds: [] };
    const named = FOLDER_KEY.exec(key);
    const ids = named?.[1] ? this.hostsByName.get(named[1]) : undefined;
    // Two hosts with one name: the key does not say which, so it is not guessed.
    const hostId = ids?.size === 1 ? [...ids][0] : undefined;
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

  /**
   * Whether a thing that touches several projects (a message between two sessions) shows: any of
   * them is in the selection; a `null` is a project the app cannot place, which is Unassigned.
   */
  includesAny(selection: string, projectKeys: ReadonlyArray<string | null>): boolean {
    if (selection === ALL_CLIENTS) return true;
    return projectKeys.some((key) =>
      key === null ? selection === UNASSIGNED : this.includes(selection, key),
    );
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

/** The project key of every session the app lists, by the managed id and by Claude's id. */
export function sessionProjectKeys(
  rows: ReadonlyArray<{
    sessionId: string | null;
    claudeSessionId: string | null;
    projectKey: string;
  }>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const row of rows) {
    for (const id of [row.sessionId, row.claudeSessionId]) if (id) keys.set(id, row.projectKey);
  }
  return keys;
}

/** The client the selection names; null for all clients, Unassigned or a client that is gone. */
export function selectedClient(clients: Client[], selection: string): Client | null {
  return clients.find((c) => c.id === selection) ?? null;
}

/** `items` with those carrying `tag` first, each group in its own order; unchanged without a tag. */
export function tagsFirst<T extends { tags: readonly string[] }>(
  items: readonly T[],
  tag: string | undefined,
): T[] {
  if (tag === undefined) return [...items];
  const tagged = (item: T) => item.tags.includes(tag);
  return [...items.filter(tagged), ...items.filter((item) => !tagged(item))];
}
