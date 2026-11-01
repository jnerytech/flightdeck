import type { ClientScope } from "./client-scope.ts";
import { type Client, UNASSIGNED } from "./clients.ts";
import type { SecretMeta } from "./vault.ts";

/** The id every rule generated for a client's secrets starts with: they are never stored. */
export const SCOPE_RULE_PREFIX = "client-scope:";

/** The client that keeps a secret in its projects: the first with `vaultScope` and the secret's tag. */
export function scopingClient(secret: Pick<SecretMeta, "tags">, clients: Client[]): Client | null {
  return (
    clients.find(
      (c) =>
        c.defaults.vaultScope &&
        c.defaults.vaultTag !== undefined &&
        secret.tags.includes(c.defaults.vaultTag),
    ) ?? null
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The rules a scoped secret is given besides its own, in the order they are tried: for each
 * project of the client a copy of each own rule limited to that project (or an `ask` where the
 * secret has no rules), then a `deny` for Claude, automations and workflows anywhere else. The
 * requester `you` is not denied. The own rules follow, as the person wrote them.
 */
export function generatedScopeRules(
  client: Pick<Client, "id">,
  projectKeys: string[],
  own: unknown[],
): unknown[] {
  const prefix = `${SCOPE_RULE_PREFIX}${client.id}:`;
  const rules: unknown[] = [];
  projectKeys.forEach((project, i) => {
    const before = rules.length;
    own.forEach((rule, j) => {
      if (!isRecord(rule)) return;
      const match = isRecord(rule.match) ? rule.match : {};
      // A rule that names another project is not this project's.
      if (typeof match.project === "string" && match.project !== project) return;
      rules.push({ ...rule, id: `${prefix}${i}:${j}`, match: { ...match, project } });
    });
    // Nothing of the secret's own applies here: each use is asked for.
    if (rules.length === before) {
      rules.push({ id: `${prefix}${i}`, match: { project }, decision: "ask" });
    }
  });
  for (const requester of ["claude", "automation", "workflow"]) {
    rules.push({ id: `${prefix}deny:${requester}`, match: { requester }, decision: "deny" });
  }
  return rules;
}

/** What the daemon is sent for a secret: its own rules, with the client's scope in front. */
export function effectiveRules(
  secret: Pick<SecretMeta, "tags">,
  own: unknown[],
  clients: Client[],
  projectsOf: (clientId: string) => string[],
): unknown[] {
  const client = scopingClient(secret, clients);
  if (!client) return own;
  return [...generatedScopeRules(client, projectsOf(client.id), own), ...own];
}

export interface VaultFinding {
  secretId: string;
  secretName: string;
  kind: "rule-reaches-other-client" | "hosts-wider";
  /** The project of another client a rule names, or the hosts beyond the client's. */
  detail: string[];
}

/**
 * Read-only: what stops a client's tagged secrets from staying in the client. A rule that lets
 * or asks for a project of another client, and `allowedHosts` wider than the hosts that hold the
 * client's projects.
 */
export function vaultFindings(args: {
  client: Pick<Client, "id" | "defaults">;
  secrets: SecretMeta[];
  rulesOf(secretId: string): unknown[];
  scope: ClientScope;
  /** The ids of the hosts that hold a project of the client. */
  holdingHosts: string[];
}): VaultFinding[] {
  const { client, secrets, rulesOf, scope, holdingHosts } = args;
  const tag = client.defaults.vaultTag;
  if (!tag) return [];
  const found: VaultFinding[] = [];
  for (const secret of secrets.filter((s) => s.tags.includes(tag))) {
    const reached = rulesOf(secret.id).flatMap((rule) => {
      if (!isRecord(rule) || !isRecord(rule.match)) return [];
      const project = rule.match.project;
      const lets = rule.decision === "allow" || rule.decision === "ask";
      return lets && typeof project === "string" ? [project] : [];
    });
    const others = [...new Set(reached)].filter((project) => {
      const owner = scope.clientOf(project);
      return owner !== client.id && owner !== UNASSIGNED;
    });
    const base = { secretId: secret.id, secretName: secret.name };
    if (others.length > 0)
      found.push({ ...base, kind: "rule-reaches-other-client", detail: others });
    const wider = secret.allowedHosts.filter((host) => !holdingHosts.includes(host));
    if (holdingHosts.length > 0 && wider.length > 0) {
      found.push({ ...base, kind: "hosts-wider", detail: wider });
    }
  }
  return found;
}

export interface SecretGroup {
  kind: "client" | "none" | "others";
  secrets: SecretMeta[];
}

/**
 * The vault's list when a client with a vault tag is selected: its secrets first, then those no
 * client's tag is on, then the ones of other clients. Nothing is left out; empty groups are.
 */
export function groupSecrets(
  secrets: SecretMeta[],
  clients: Client[],
  selected: Client | null,
): SecretGroup[] {
  const tag = selected?.defaults.vaultTag;
  if (tag === undefined) return [{ kind: "none", secrets }];
  const tags = new Set(clients.flatMap((c) => (c.defaults.vaultTag ? [c.defaults.vaultTag] : [])));
  const mine = secrets.filter((s) => s.tags.includes(tag));
  const others = secrets.filter((s) => !s.tags.includes(tag) && s.tags.some((t) => tags.has(t)));
  const none = secrets.filter((s) => !mine.includes(s) && !others.includes(s));
  const groups: SecretGroup[] = [
    { kind: "client", secrets: mine },
    { kind: "none", secrets: none },
    { kind: "others", secrets: others },
  ];
  return groups.filter((g) => g.secrets.length > 0);
}
