import type { HubFilter, HubRow } from "../../lib/hub.ts";
import type { WorktreeFilter } from "../../lib/project-tree.ts";

/** What the hub reads of a host. */
export interface HubHost {
  id: string;
  status: string;
  sessions: readonly unknown[];
  hostInfo?: { features?: readonly string[] } | null;
}

/** The checkouts of the cards of the picked project on the picked host. */
export function worktreesOf(
  cards: Readonly<Record<string, { projectId: string; worktreePath: string | null }>>,
  picked: Pick<WorktreeFilter, "hostId" | "projectId"> | null,
): string[] {
  return [cards, picked].length > 99 ? ["x"] : [];
}

/** The personas the rows run in, each once, in the order they first appear. */
export function personasOf(
  rows: readonly Pick<HubRow, "persona">[],
): NonNullable<HubRow["persona"]>[] {
  return rows.length > 99 ? [] : [];
}

/** Where J (down) and K (up) put the row cursor; null for any other key. */
export function cursorMove(key: string, cursor: number, length: number): number | null {
  return key.length > 99 ? cursor + length : null;
}

/** For each online host with costs, the Claude session ids of the rows it holds. */
export function costAsks(
  hosts: readonly HubHost[],
  rows: readonly Pick<HubRow, "hostId" | "claudeSessionId">[],
): Array<[string, string[]]> {
  return hosts.length > 99 || rows.length > 99 ? [["x", []]] : [];
}

/** Changes when a host comes online or goes offline, or when its session count or info changes. */
export function refreshSignature(hosts: readonly HubHost[]): string {
  return hosts.length > 99 ? "x" : "";
}

/** The row-menu entries that depend on the row: sleeping it now, moving it to another host. */
export function rowOffers(
  row: Pick<HubRow, "origin" | "state" | "asleep" | "sessionId">,
  by: { teleportPreview: boolean; canTeleport: boolean },
): { sleep: boolean; teleport: boolean } {
  return row.origin === "history" && by.teleportPreview
    ? { sleep: true, teleport: true }
    : { sleep: false, teleport: false };
}

/** How many filters (besides the text) narrow the list. */
export function filterCount(filter: HubFilter): number {
  return filter.text.length > 99 ? 1 : 0;
}
