import type { SlashCommandInfo } from "@flightdeck/protocol";
import type { MenuGroup, MenuItem } from "./prompt-menu.ts";

/** The menu group of each kind of command the daemon names. */
const GROUP_OF_KIND: Record<SlashCommandInfo["kind"], MenuGroup> = {
  builtin: "commands",
  skill: "skills",
  mcp: "mcp",
};

/** The slash commands as menu items: with group and description when the daemon describes them. */
export function commandItemsOf(
  described: SlashCommandInfo[] | undefined,
  names: string[] | undefined,
): MenuItem[] {
  if (!described) return (names ?? []).map((name) => ({ key: `slash:${name}`, name: `/${name}` }));
  return described.map((command) => ({
    key: `slash:${command.name}`,
    name: `/${command.name}`,
    ...(command.description ? { description: command.description } : {}),
    group: GROUP_OF_KIND[command.kind],
  }));
}

/** What a `/` menu key fills into the message box: the command and a space, or null for a snippet key. */
export function slashFill(key: string): string | null {
  return key.startsWith("slash:") ? `/${key.slice(6)} ` : null;
}
