import type { SlashCommandInfo } from "@flightdeck/protocol";
import type { MenuGroup, MenuItem } from "../../lib/prompt-menu.ts";

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
