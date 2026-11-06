/** What the `/` menu of a message box offers: grouped, filtered as you type, with the match marked. */

export interface MenuItem {
  key: string;
  name: string;
  /** One line about the item, shown for the selected one; the commands of a session carry none. */
  description?: string;
  /** The group the daemon put it in; without it the shape of the name decides. */
  group?: MenuGroup;
}

export type MenuGroup = "commands" | "snippets" | "skills" | "mcp";

/** The order the groups are listed in. */
export const MENU_GROUPS: readonly MenuGroup[] = ["commands", "snippets", "skills", "mcp"];

/** Which group an item belongs to: snippets by key, then by the shape of the command's name. */
export function groupOf(item: MenuItem): MenuGroup {
  if (item.group) return item.group;
  if (!item.key.startsWith("slash:")) return "snippets";
  const name = item.name.replace(/^\//, "");
  if (name.startsWith("mcp__")) return "mcp";
  // A plugin's skill is namespaced (`plugin:skill`); the session does not say more about a command.
  if (name.includes(":")) return "skills";
  return "commands";
}

/** The positions of `query` in `text` as a run when it is contiguous, else as a subsequence. */
function matchAt(text: string, query: string): { at: number[]; contiguous: boolean } | null {
  const lower = text.toLowerCase();
  const found = lower.indexOf(query);
  if (found >= 0) {
    return { at: Array.from({ length: query.length }, (_, i) => found + i), contiguous: true };
  }
  const at: number[] = [];
  let from = 0;
  for (const char of query) {
    const next = lower.indexOf(char, from);
    if (next < 0) return null;
    at.push(next);
    from = next + 1;
  }
  return { at, contiguous: false };
}

/** How well a query fits an item (higher is better), or null when it does not fit at all. */
export function fuzzyScore(query: string, item: MenuItem): number | null {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return 0;
  const inName = matchAt(item.name, wanted);
  if (inName) return (inName.contiguous ? 1000 : 500) - (inName.at[0] ?? 0);
  const inText = item.description ? matchAt(item.description, wanted) : null;
  if (inText) return inText.contiguous ? 100 : 50;
  return null;
}

export interface MenuSection {
  group: MenuGroup;
  items: MenuItem[];
}

/** The items that fit the query, in groups (empty ones left out), best match first in each. */
export function filterMenu(items: MenuItem[], query: string): MenuSection[] {
  const scored = items.flatMap((item, order) => {
    const score = fuzzyScore(query, item);
    return score === null ? [] : [{ item, score, order }];
  });
  return MENU_GROUPS.flatMap((group) => {
    const own = scored
      .filter((entry) => groupOf(entry.item) === group)
      .sort((a, b) => b.score - a.score || a.order - b.order);
    return own.length === 0 ? [] : [{ group, items: own.map((entry) => entry.item) }];
  });
}

/** A name cut into the runs the query matched and the runs it did not. */
export function highlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const wanted = query.trim().toLowerCase();
  const match = wanted === "" ? null : matchAt(text, wanted);
  if (!match) return [{ text, hit: false }];
  const hits = new Set(match.at);
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (const [index, char] of [...text].entries()) {
    const hit = hits.has(index);
    const last = runs.at(-1);
    if (last && last.hit === hit) last.text += char;
    else runs.push({ text: char, hit });
  }
  return runs;
}
