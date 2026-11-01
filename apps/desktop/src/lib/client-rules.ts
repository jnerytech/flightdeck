import { type ClientsData, type RuleInput, UNASSIGNED } from "./clients.ts";
import { isInside } from "./paths.ts";

/** A project the app knows: its key and the folders (per host) its sessions ran in. */
export interface KnownProject {
  key: string;
  cwds: Array<{ hostId: string; path: string }>;
}

/** The client a project resolved to, and how. */
export interface Resolved {
  clientId: string;
  via: "override" | "rule" | "none";
  ruleId: string | null;
  /** The other clients whose rules claim a folder of the same project; the first client won. */
  conflict: string[];
}

type Folder = KnownProject["cwds"][number];

/** A project with no remote is keyed `host:<hostId>:<folder>`. */
const FOLDER_KEY = /^host:([^:]+):(.+)$/;

/** The folders of a project: the one a folder key names and the ones its sessions ran in. */
function foldersOf(project: KnownProject): Folder[] {
  const named = FOLDER_KEY.exec(project.key);
  return named?.[1] && named[2]
    ? [{ hostId: named[1], path: named[2] }, ...project.cwds]
    : project.cwds;
}

/** A remote rule: a trailing `*` is a prefix, else the whole remote; a folder key has no remote. */
function remoteMatches(pattern: string, key: string): boolean {
  if (FOLDER_KEY.test(key)) return false;
  const [p, k] = [pattern.toLowerCase(), key.toLowerCase()];
  return p.endsWith("*") ? k.startsWith(p.slice(0, -1)) : k === p;
}

/** Whether a rule claims a project when only `folder` (or none) of its folders is considered. */
function matchesAt(rule: RuleInput, key: string, folder: Folder | null): boolean {
  if (rule.kind === "remote") return remoteMatches(rule.pattern, key);
  return (
    folder !== null &&
    (rule.host === undefined || folder.hostId === rule.host) &&
    isInside(folder.path, rule.path)
  );
}

/** Whether one rule claims a project. */
export function ruleMatches(rule: RuleInput, project: KnownProject): boolean {
  if (rule.kind === "remote") return remoteMatches(rule.pattern, project.key);
  return foldersOf(project).some((folder) => matchesAt(rule, project.key, folder));
}

/** The client of a project: a manual override, else the first client with a rule that matches. */
export function resolveClient(
  project: KnownProject,
  data: Pick<ClientsData, "clients" | "overrides">,
): Resolved {
  const pinned = data.overrides[project.key];
  if (pinned === null) return { clientId: UNASSIGNED, via: "override", ruleId: null, conflict: [] };
  if (pinned !== undefined && data.clients.some((c) => c.id === pinned)) {
    return { clientId: pinned, via: "override", ruleId: null, conflict: [] };
  }
  // Each folder is judged alone: a project run in two folders of two clients is a conflict.
  const folders = foldersOf(project);
  const winners: Array<{ index: number; ruleId: string }> = [];
  for (const folder of folders.length > 0 ? folders : [null]) {
    for (const [index, client] of data.clients.entries()) {
      const rule = client.rules.find((r) => matchesAt(r, project.key, folder));
      if (rule) {
        winners.push({ index, ruleId: rule.id });
        break;
      }
    }
  }
  const first = winners.reduce<(typeof winners)[number] | null>(
    (best, w) => (best === null || w.index < best.index ? w : best),
    null,
  );
  const won = first && data.clients[first.index];
  if (!first || !won) return { clientId: UNASSIGNED, via: "none", ruleId: null, conflict: [] };
  const claiming = new Set(winners.map((w) => w.index));
  const others = data.clients
    .filter((_, index) => index !== first.index && claiming.has(index))
    .map((c) => c.id);
  return { clientId: won.id, via: "rule", ruleId: first.ruleId, conflict: others };
}

/** The projects a rule claims right now, for its "matches N projects" preview. */
export function projectsMatching(rule: RuleInput, projects: KnownProject[]): KnownProject[] {
  return projects.filter((project) => ruleMatches(rule, project));
}

/** The projects behind a list of session rows, each with the folders it ran in. */
export function knownProjects(
  rows: ReadonlyArray<{ hostId: string; cwd: string; projectKey: string }>,
): KnownProject[] {
  const byKey = new Map<string, KnownProject>();
  for (const row of rows) {
    let project = byKey.get(row.projectKey);
    if (!project) {
      project = { key: row.projectKey, cwds: [] };
      byKey.set(row.projectKey, project);
    }
    const known = project.cwds.some((c) => c.hostId === row.hostId && c.path === row.cwd);
    if (row.cwd && !known) project.cwds.push({ hostId: row.hostId, path: row.cwd });
  }
  return [...byKey.values()];
}
