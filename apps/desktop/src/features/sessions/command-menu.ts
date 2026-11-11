import type { SlashCommandInfo } from "@flightdeck/protocol";
import type { MenuItem } from "../../lib/prompt-menu.ts";

/** The slash commands as menu items: with group and description when the daemon describes them. */
export function commandItemsOf(
  _described: SlashCommandInfo[] | undefined,
  _names: string[] | undefined,
): MenuItem[] {
  return [];
}
