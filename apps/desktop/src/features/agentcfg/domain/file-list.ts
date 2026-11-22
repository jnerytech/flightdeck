import type { AgentCfgItem } from "@flightdeck/protocol";

/** The folder the user's own files live in; their paths are relative to it. */
const USER_DIR = "~/.claude";

/** A file's path as a person reads it: the user's files keep their `~/.claude` folder, the project's are relative to it. */
export function shownPath(item: Pick<AgentCfgItem, "origin" | "path">): string {
  return item.origin === "user" ? `${USER_DIR}/${item.path}` : item.path;
}

/** What a list row calls a file: its name, or its path when it has none. */
export const titleOf = (item: AgentCfgItem): string => item.name ?? shownPath(item);

/** The project's root CLAUDE.md first, then the project's other files, then the user's; the daemon's order inside each group. */
export function inReadingOrder(items: AgentCfgItem[]): AgentCfgItem[] {
  const rank = (item: AgentCfgItem) => {
    if (item.origin === "user") return 2;
    return item.path === "CLAUDE.md" ? 0 : 1;
  };
  return items.toSorted((a, b) => rank(a) - rank(b));
}

/** A path of the context screen: relative to the project, else under `~`, else as the daemon sent it. */
export function contextPath(path: string, root?: string, home?: string): string {
  if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}
