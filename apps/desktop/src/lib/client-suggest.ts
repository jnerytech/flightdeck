import { type KnownProject, resolveClient } from "./client-rules.ts";
import type { Client, Clients, ClientsData } from "./clients.ts";

/** One client the app offers to create from the remotes it has seen. */
export interface Suggestion {
  name: string;
  pattern: string;
  /** The keys of the projects the rule would newly claim. */
  projects: string[];
  /** A client that already has this name: the rule is added to it instead of a new client. */
  existingClientId: string | null;
}

/** The owner a remote (`host/owner/repo`) belongs to, as a client name and a rule; null without one. */
function ownerOf(key: string): { name: string; pattern: string } | null {
  if (key.startsWith("host:")) return null;
  const parts = key.split("/");
  // Azure DevOps over ssh puts a `v3` before the organization.
  const at = parts[0] === "ssh.dev.azure.com" && parts[1] === "v3" ? 2 : 1;
  const name = parts[at];
  if (!name || parts.length < at + 2) return null;
  return { name, pattern: `${parts.slice(0, at + 1).join("/")}/*` };
}

/** One suggestion per owner of the remotes in `projects` that no client or override claims yet. */
export function suggestClients(
  projects: KnownProject[],
  data: Pick<ClientsData, "clients" | "overrides">,
): Suggestion[] {
  const groups = new Map<string, Suggestion>();
  for (const project of projects) {
    const owner = ownerOf(project.key);
    if (!owner || resolveClient(project, data).via !== "none") continue;
    const group = groups.get(owner.pattern);
    if (group) group.projects.push(project.key);
    else {
      const same = data.clients.find((c) => c.name.toLowerCase() === owner.name.toLowerCase());
      groups.set(owner.pattern, {
        name: owner.name,
        pattern: owner.pattern,
        projects: [project.key],
        existingClientId: same?.id ?? null,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.projects.length - a.projects.length || a.pattern.localeCompare(b.pattern),
  );
}

/** Creates the client (or finds the one with that name) and gives it the suggested rule. */
export function applySuggestion(clients: Clients, suggestion: Suggestion): Client | null {
  const id = suggestion.existingClientId ?? clients.add(suggestion.name)?.id;
  if (!id || !clients.list().some((c) => c.id === id)) return null;
  clients.addRule(id, { kind: "remote", pattern: suggestion.pattern });
  return clients.list().find((c) => c.id === id) ?? null;
}
