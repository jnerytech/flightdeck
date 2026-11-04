import type { SlashCommandInfo } from "@flightdeck/protocol";

/** What the SDK says about a slash command (`supportedCommands()`). */
export interface SdkSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
  /** True for Claude Code's own commands; absent for a user's, a project's, a plugin's or an MCP server's. */
  builtin?: boolean;
}

/** The commands of a session as the app lists them: with a description and a kind. */
export function describeCommands(commands: readonly SdkSlashCommand[]): SlashCommandInfo[] {
  return commands.map((command) => ({
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    // The SDK marks Claude Code's own; an MCP prompt is named for its server; the rest are skills.
    kind: command.builtin ? "builtin" : command.name.startsWith("mcp__") ? "mcp" : "skill",
  }));
}
