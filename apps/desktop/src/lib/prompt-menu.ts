/** What the `/` menu of a message box offers: grouped, filtered as you type, with the match marked. */

export interface MenuItem {
  key: string;
  name: string;
  /** One line about the item, shown for the selected one; the commands of a session carry none. */
  description?: string;
}

export type MenuGroup = "commands" | "snippets" | "skills" | "mcp";

/** The order the groups are listed in. */
export const MENU_GROUPS: readonly MenuGroup[] = ["commands", "snippets", "skills", "mcp"];

/** Which group an item belongs to: snippets by key, then by the shape of the command's name. */
export function groupOf(_item: MenuItem): MenuGroup {
  return "commands";
}

/** How well a query fits an item (higher is better), or null when it does not fit at all. */
export function fuzzyScore(_query: string, _item: MenuItem): number | null {
  return null;
}

export interface MenuSection {
  group: MenuGroup;
  items: MenuItem[];
}

/** The items that fit the query, in groups (empty ones left out), best match first in each. */
export function filterMenu(_items: MenuItem[], _query: string): MenuSection[] {
  return [];
}

/** A name cut into the runs the query matched and the runs it did not. */
export function highlight(text: string, _query: string): Array<{ text: string; hit: boolean }> {
  return [{ text, hit: false }];
}
