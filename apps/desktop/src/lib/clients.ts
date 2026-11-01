import { z } from "zod";
import type { Platform } from "../platform/types.ts";

/** Where the clients are kept (phase 29). */
export const CLIENTS_KEY = "flightdeck.clients";

/** The id of the virtual client that holds every project no rule and no override claims. */
export const UNASSIGNED = "unassigned";

export const CLIENT_COLORS = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "orange",
] as const;
export type ClientColor = (typeof CLIENT_COLORS)[number];

/** How a project joins a client: by its remote (`github.com/acme/*`) or by a folder prefix. */
export type ClientRule =
  | { id: string; kind: "remote"; pattern: string }
  | { id: string; kind: "folder"; path: string; host?: string };

/** What a rule takes before it has an id. */
export type RuleInput =
  | { kind: "remote"; pattern: string }
  | { kind: "folder"; path: string; host?: string };

export interface ClientDefaults {
  persona?: string;
  snippetTag?: string;
  vaultTag?: string;
  vaultScope: boolean;
}

export interface Client {
  id: string;
  name: string;
  color: ClientColor;
  rules: ClientRule[];
  defaults: ClientDefaults;
}

/** What is stored; `overrides` maps a `projectKey` to a client id, or to null (pinned to Unassigned). */
export interface ClientsData {
  v: 1;
  clients: Client[];
  overrides: Record<string, string | null>;
}

export interface ClientsOptions {
  newId?: () => string;
  /** Called after a change was written, so the app can show it. */
  onChange?: () => void;
}

/** What an import did, or null when the text was not a client export. */
export interface ImportResult {
  added: number;
  updated: number;
}

const RuleSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("remote"), pattern: z.string() }),
  z.object({
    id: z.string(),
    kind: z.literal("folder"),
    path: z.string(),
    host: z.string().optional(),
  }),
]);

const DefaultsSchema = z.object({
  persona: z.string().optional(),
  snippetTag: z.string().optional(),
  vaultTag: z.string().optional(),
  vaultScope: z.boolean().default(false),
});

const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.enum(CLIENT_COLORS),
  rules: z.array(RuleSchema),
  defaults: DefaultsSchema.default(() => ({ vaultScope: false })),
});

const DataSchema = z.object({
  v: z.literal(1),
  clients: z.array(ClientSchema),
  overrides: z.record(z.string(), z.string().nullable()),
});

const empty = (): ClientsData => ({ v: 1, clients: [], overrides: {} });

/** The index `index` clamped to a list of `length` items. */
const clamp = (index: number, length: number) => Math.max(0, Math.min(index, length - 1));

/** `items` with the one satisfying `isIt` put at `index`; null when there is none. */
function placed<T>(items: T[], isIt: (item: T) => boolean, index: number): T[] | null {
  const from = items.findIndex(isIt);
  const item = items[from];
  if (item === undefined) return null;
  const rest = items.filter((_, i) => i !== from);
  rest.splice(clamp(index, items.length), 0, item);
  return rest;
}

/** Phase 29: the clients, their rules and the manual overrides, kept by the app. */
export class Clients {
  constructor(
    private readonly platform: Pick<Platform, "storage">,
    private readonly options: ClientsOptions = {},
  ) {}

  private read(): ClientsData {
    try {
      const parsed = DataSchema.safeParse(
        JSON.parse(this.platform.storage.getItem(CLIENTS_KEY) ?? "null"),
      );
      return parsed.success ? parsed.data : empty();
    } catch {
      return empty();
    }
  }

  private write(data: ClientsData): void {
    this.platform.storage.setItem(CLIENTS_KEY, JSON.stringify(data));
    this.options.onChange?.();
  }

  /** Changes the client `id` with `change`, which returns false to leave it as it was. */
  private edit(id: string, change: (client: Client, data: ClientsData) => boolean): boolean {
    const data = this.read();
    const client = data.clients.find((c) => c.id === id);
    if (!client || !change(client, data)) return false;
    this.write(data);
    return true;
  }

  private newId(): string {
    return (this.options.newId ?? (() => crypto.randomUUID()))();
  }

  list(): Client[] {
    return this.read().clients;
  }

  overrides(): Record<string, string | null> {
    return this.read().overrides;
  }

  add(name: string): Client | null {
    const data = this.read();
    const clean = name.trim();
    if (!clean || taken(data, clean)) return null;
    const client: Client = {
      id: this.newId(),
      name: clean,
      color: CLIENT_COLORS[data.clients.length % CLIENT_COLORS.length] ?? "indigo",
      rules: [],
      defaults: { vaultScope: false },
    };
    this.write({ ...data, clients: [...data.clients, client] });
    return client;
  }

  rename(id: string, name: string): boolean {
    const clean = name.trim();
    return this.edit(id, (client, data) => {
      if (!clean || taken(data, clean, id)) return false;
      client.name = clean;
      return true;
    });
  }

  recolor(id: string, color: ClientColor): boolean {
    return this.edit(id, (client) => {
      client.color = color;
      return true;
    });
  }

  /** Puts the client at `index` of the list (the order is the order rules are tried in). */
  move(id: string, index: number): boolean {
    const data = this.read();
    const clients = placed(data.clients, (c) => c.id === id, index);
    if (!clients) return false;
    this.write({ ...data, clients });
    return true;
  }

  remove(id: string): boolean {
    const data = this.read();
    if (!data.clients.some((c) => c.id === id)) return false;
    this.write({
      ...data,
      clients: data.clients.filter((c) => c.id !== id),
      overrides: Object.fromEntries(Object.entries(data.overrides).filter(([, to]) => to !== id)),
    });
    return true;
  }

  addRule(clientId: string, rule: RuleInput): ClientRule | null {
    const made = this.ruleOf(rule);
    if (!made) return null;
    return this.edit(clientId, (client) => {
      client.rules.push(made);
      return true;
    })
      ? made
      : null;
  }

  removeRule(clientId: string, ruleId: string): boolean {
    return this.edit(clientId, (client) => {
      const before = client.rules.length;
      client.rules = client.rules.filter((r) => r.id !== ruleId);
      return client.rules.length < before;
    });
  }

  /** Puts the rule at `index` among its client's rules. */
  moveRule(clientId: string, ruleId: string, index: number): boolean {
    return this.edit(clientId, (client) => {
      const rules = placed(client.rules, (r) => r.id === ruleId, index);
      if (!rules) return false;
      client.rules = rules;
      return true;
    });
  }

  /** Pins a project to a client, or to Unassigned with null; false for a client that does not exist. */
  setOverride(projectKey: string, clientId: string | null): boolean {
    const data = this.read();
    if (clientId !== null && !data.clients.some((c) => c.id === clientId)) return false;
    this.write({ ...data, overrides: { ...data.overrides, [projectKey]: clientId } });
    return true;
  }

  clearOverride(projectKey: string): void {
    const data = this.read();
    if (!(projectKey in data.overrides)) return;
    const { [projectKey]: _gone, ...overrides } = data.overrides;
    this.write({ ...data, overrides });
  }

  setDefaults(clientId: string, patch: Partial<ClientDefaults>): boolean {
    return this.edit(clientId, (client) => {
      const next: ClientDefaults = { ...client.defaults };
      for (const key of ["persona", "snippetTag", "vaultTag"] as const) {
        const raw = patch[key];
        if (raw === undefined) continue;
        const value = raw.trim();
        if (value) next[key] = value;
        else delete next[key];
      }
      if (patch.vaultScope !== undefined) next.vaultScope = patch.vaultScope;
      client.defaults = next;
      return true;
    });
  }

  exportJson(): string {
    return JSON.stringify(this.read());
  }

  /** Merges an export by client id: same id replaces that client, a new id is added, nothing is deleted. */
  importJson(text: string): ImportResult | null {
    let parsed: ReturnType<typeof DataSchema.safeParse>;
    try {
      parsed = DataSchema.safeParse(JSON.parse(text));
    } catch {
      return null;
    }
    if (!parsed.success) return null;
    const data = this.read();
    const result = { added: 0, updated: 0 };
    const clients = [...data.clients];
    for (const incoming of parsed.data.clients) {
      const at = clients.findIndex((c) => c.id === incoming.id);
      if (at < 0) {
        clients.push(incoming);
        result.added++;
      } else {
        clients[at] = incoming;
        result.updated++;
      }
    }
    const overrides = { ...data.overrides };
    for (const [key, to] of Object.entries(parsed.data.overrides)) {
      if (to === null || clients.some((c) => c.id === to)) overrides[key] = to;
    }
    this.write({ v: 1, clients, overrides });
    return result;
  }

  /** The rule a person typed as it is stored, or null when it says nothing. */
  private ruleOf(rule: RuleInput): ClientRule | null {
    if (rule.kind === "remote") {
      const pattern = rule.pattern.trim().toLowerCase();
      return pattern && !/\s/.test(pattern) ? { id: this.newId(), kind: "remote", pattern } : null;
    }
    const path = rule.path.trim();
    if (!path) return null;
    const host = rule.host?.trim();
    return { id: this.newId(), kind: "folder", path, ...(host ? { host } : {}) };
  }
}

/** Whether a client already has that name (in any case), leaving out the client `except`. */
function taken(data: ClientsData, name: string, except?: string): boolean {
  const lower = name.toLowerCase();
  return data.clients.some((c) => c.id !== except && c.name.toLowerCase() === lower);
}
