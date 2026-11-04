import type { SlashCommandInfo } from "@flightdeck/protocol";

/** What the SDK says about a slash command (`supportedCommands()`). */
export interface SdkSlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
  builtin?: boolean;
}

/** The commands of a session as the app lists them: with a description and a kind. */
export function describeCommands(_commands: readonly SdkSlashCommand[]): SlashCommandInfo[] {
  return [];
}
