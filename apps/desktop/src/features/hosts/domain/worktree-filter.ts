import type { WorktreeItem } from "@flightdeck/protocol";
import type { Key, T } from "../../../i18n/index.ts";

export type Filter = "all" | "suggested" | "protected" | "noCard";
export type Sort = "age" | "size";

export const FILTERS: Filter[] = ["all", "suggested", "protected", "noCard"];

/** A disk with less than this share free is warned about. */
export const LOW_DISK = 0.1;

export const keep: Record<Filter, (item: WorktreeItem) => boolean> = {
  all: () => true,
  suggested: (item) => item.suggested,
  protected: (item) => item.blockers.length > 0,
  noCard: (item) => item.cardId === null,
};

/** Why a worktree is kept, in words: the blockers, with the unpushed count. */
export function reasonText(item: Pick<WorktreeItem, "blockers" | "unpushed">, t: T): string {
  return item.blockers
    .map((blocker) => {
      if (blocker !== "unpushed") return t(`worktrees.reasons.${blocker}` as Key);
      const key =
        item.unpushed === 1 ? "worktrees.reasons.unpushedOne" : "worktrees.reasons.unpushed";
      return t(key, { n: item.unpushed });
    })
    .join("; ");
}
