import type { HubFilter, HubRow } from "../../lib/hub.ts";
import type { WorktreeFilter } from "../../lib/project-tree.ts";
import { hostsWith } from "../../lib/version.ts";

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
  if (!picked) return [];
  return Object.entries(cards)
    .filter(
      ([key, card]) => key.startsWith(`${picked.hostId}/`) && card.projectId === picked.projectId,
    )
    .flatMap(([, card]) => (card.worktreePath ? [card.worktreePath] : []));
}

/** The personas the rows run in, each once, in the order they first appear. */
export function personasOf(
  rows: readonly Pick<HubRow, "persona">[],
): NonNullable<HubRow["persona"]>[] {
  return [
    ...new Map(
      rows.flatMap((r) => (r.persona ? [[r.persona.id, r.persona] as const] : [])),
    ).values(),
  ];
}

/** Where J (down) and K (up) put the row cursor; null for any other key. */
export function cursorMove(key: string, cursor: number, length: number): number | null {
  if (key === "j") return Math.min(length - 1, cursor + 1);
  if (key === "k") return Math.max(0, cursor - 1);
  return null;
}

/** For each online host with costs, the Claude session ids of the rows it holds. */
export function costAsks(
  hosts: readonly HubHost[],
  rows: readonly Pick<HubRow, "hostId" | "claudeSessionId">[],
): Array<[string, string[]]> {
  return hostsWith(hosts, "costs").map((h) => [
    h.id,
    rows.flatMap((r) => (r.hostId === h.id && r.claudeSessionId ? [r.claudeSessionId] : [])),
  ]);
}

/** Changes when a host comes online or goes offline, or when its session count or info changes. */
export function refreshSignature(hosts: readonly HubHost[]): string {
  return hosts
    .map((h) => `${h.id}:${h.status === "online"}:${h.sessions.length}:${h.hostInfo ? "info" : ""}`)
    .join();
}

/** The row-menu entries that depend on the row: sleeping it now, moving it to another host. */
export function rowOffers(
  row: Pick<HubRow, "origin" | "state" | "asleep" | "sessionId">,
  by: { teleportPreview: boolean; canTeleport: () => boolean },
): { sleep: boolean; teleport: boolean } {
  const idleManaged = row.origin === "flightdeck" && row.state === "idle" && !!row.sessionId;
  return {
    sleep: idleManaged && !row.asleep,
    teleport: idleManaged && by.teleportPreview && by.canTeleport(),
  };
}

/** How many filters (besides the text) narrow the list. */
export function filterCount(filter: HubFilter): number {
  return [
    filter.origin !== "",
    filter.state !== "",
    filter.persona !== "",
    filter.pinnedOnly,
    filter.showArchived,
  ].filter(Boolean).length;
}
