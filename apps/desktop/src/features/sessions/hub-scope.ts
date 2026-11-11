import type { DataScope } from "../../lib/data-scope.ts";
import type { HubRow } from "../../lib/hub.ts";
import type { WorktreeFilter } from "../../lib/project-tree.ts";

type Where = Pick<HubRow, "hostId" | "projectKey" | "cwd">;

/** The host and the project the scope pins; an empty string means it pins none. */
export function scopeKeys(_scope: DataScope): { host: string; project: string } {
  return { host: "?", project: "?" };
}

/** The scoped host, when it is offline (not still connecting): the hub says so and offers all. */
export function awayHost<H extends { id: string; status: string }>(
  _hosts: readonly H[],
  _scope: DataScope,
): H | undefined {
  return undefined;
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
export function rowsInScope<R extends Where>(_rows: readonly R[], _by: RowNarrowing): R[] {
  return [];
}

/** The keys of the hub's projects: those of its rows and the scoped one, each once and none empty. */
export function hubProjectKeys(
  _rows: readonly Pick<HubRow, "projectKey">[],
  _scoped: string,
): string[] {
  return ["?"];
}

/** The projects the scope menu offers, by label. A key with no name yet reads as its folder or remote. */
export function projectChoices(
  _keys: readonly string[],
  _names: ReadonlyMap<string, string>,
): { key: string; label: string }[] {
  return [];
}
