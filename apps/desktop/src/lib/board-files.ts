import type { Card } from "@flightdeck/protocol";
import type { WorktreeFilter } from "./project-tree.ts";
import { hasFeature } from "./version.ts";

/**
 * What the board's files panel shows (#117): the tree of the worktree the sidebar picked, through
 * the card that owns it (`card:<id>`), or a hint for the main checkout, which has no target yet.
 */
export type BoardFiles =
  | { kind: "worktree"; target: string; branch: string }
  | { kind: "primary"; branch: string };

/** The panel for the picked checkout of this board; `null` with none picked or a host without `file.list`. */
export function boardFiles(
  filter: WorktreeFilter | null,
  cards: readonly Pick<Card, "id" | "worktreePath">[],
  features: readonly string[] | undefined,
): BoardFiles | null {
  if (!filter || !hasFeature(features, "file.list", false)) return null;
  if (filter.kind === "primary") return { kind: "primary", branch: filter.branch };
  const owner = cards.find((card) => card.worktreePath === filter.path);
  return owner ? { kind: "worktree", target: `card:${owner.id}`, branch: filter.branch } : null;
}
