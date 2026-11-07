import type { Card } from "@flightdeck/protocol";
import type { WorktreeFilter } from "./project-tree.ts";
import { hasFeature } from "./version.ts";

/**
 * What the board's files panel shows (#117): the tree of the checkout the sidebar picked. A
 * worktree is read through the card that owns it (`card:<id>`); the main checkout through the
 * project's own read-only target (`project:<id>`), which a host announces with `file.search`
 * (#797), as it does the search. Without it, the main checkout gets a hint.
 */
export type BoardFiles =
  | { kind: "tree"; target: string; branch: string; search: boolean }
  | { kind: "primary"; branch: string };

/** The panel for the picked checkout of this board; `null` with none picked or a host without `file.list`. */
export function boardFiles(
  filter: WorktreeFilter | null,
  cards: readonly Pick<Card, "id" | "worktreePath">[],
  features: readonly string[] | undefined,
): BoardFiles | null {
  if (!filter || !hasFeature(features, "file.list", false)) return null;
  const search = hasFeature(features, "file.search", false);
  const { branch } = filter;
  if (filter.kind === "primary") {
    return search
      ? { kind: "tree", target: `project:${filter.projectId}`, branch, search }
      : { kind: "primary", branch };
  }
  const owner = cards.find((card) => card.worktreePath === filter.path);
  return owner ? { kind: "tree", target: `card:${owner.id}`, branch, search } : null;
}
