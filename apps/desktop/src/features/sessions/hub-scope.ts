import { projectLabel } from "../../lib/costs.ts";
import type { DataScope } from "../../lib/data-scope.ts";
import type { HubRow } from "../../lib/hub.ts";
import { rowInFilter, type WorktreeFilter } from "../../lib/project-tree.ts";

type Where = Pick<HubRow, "hostId" | "projectKey" | "cwd">;

/** The host and the project the scope pins; an empty string means it pins none. */
export function scopeKeys(scope: DataScope): { host: string; project: string } {
  return {
    host: scope.kind === "host" ? scope.hostId : "",
    project: scope.kind === "project" ? scope.projectKey : "",
  };
}

/** The scoped host, when it is offline (not still connecting): the hub says so and offers all. */
export function awayHost<H extends { id: string; status: string }>(
  hosts: readonly H[],
  scope: DataScope,
): H | undefined {
  if (scope.kind !== "host") return undefined;
  return hosts.find(
    (h) => h.id === scope.hostId && h.status !== "online" && h.status !== "connecting",
  );
}

/** What narrows the hub's rows besides the scope: a project asked by the route, the sidebar's checkout. */
export interface RowNarrowing {
  host: string;
  project: string;
  only: { hostId: string; projectKey: string } | null;
  picked: WorktreeFilter | null;
  pickedProject: { path: string } | undefined;
  worktrees: readonly string[];
}

/** The rows the hub draws: those of the scoped host and project, of the asked project, and of the picked checkout. */
export function rowsInScope<R extends Where>(rows: readonly R[], by: RowNarrowing): R[] {
  return rows
    .filter((row) => !by.host || row.hostId === by.host)
    .filter((row) => !by.project || row.projectKey === by.project)
    .filter(
      (row) => !by.only || (row.hostId === by.only.hostId && row.projectKey === by.only.projectKey),
    )
    .filter((row) => {
      // The branch picked in the sidebar tree keeps the sessions of that checkout.
      if (!by.picked || !by.pickedProject) return true;
      return rowInFilter(row, by.picked, by.pickedProject, by.worktrees);
    });
}

/** The keys of the hub's projects: those of its rows and the scoped one, each once and none empty. */
export function hubProjectKeys(
  rows: readonly Pick<HubRow, "projectKey">[],
  scoped: string,
): string[] {
  return [...new Set([...rows.map((row) => row.projectKey), scoped])].filter((key) => key !== "");
}

/** A project's label: its name when the app has one, else its folder or remote. */
export function projectName(key: string, names: ReadonlyMap<string, string>): string {
  return names.get(key) ?? projectLabel(key);
}

/** The projects the scope menu offers, by label. */
export function projectChoices(
  keys: readonly string[],
  names: ReadonlyMap<string, string>,
): { key: string; label: string }[] {
  return keys
    .map((key) => ({ key, label: projectName(key, names) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
