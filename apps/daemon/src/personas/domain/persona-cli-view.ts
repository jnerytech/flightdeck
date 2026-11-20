/**
 * Issue #3456: what `flightdeckd persona list|show|subagents` says, as pure rules over the daemon's
 * answers. The daemon calls and the timer stay in `personas/persona-cli.ts`.
 */
import type {
  Persona,
  PersonaProjectInfo,
  PersonaSubagents,
  ResolvedPersonaResult,
} from "@flightdeck/protocol";

export interface PersonaCliArgs {
  action: "list" | "show" | "subagents";
  /** `show`: the persona's id. */
  id?: string;
  /** `list --scope`. */
  scope?: "host" | "project" | "all";
  /** The project whose personas count too (a path on this machine). */
  projectPath?: string;
  /** The language of the pack personas. */
  language?: "pt-BR" | "en";
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** The lines `persona list` prints. */
export function listLines(_answer: {
  personas: Persona[];
  project: PersonaProjectInfo | null;
}): string[] {
  return [];
}

/** The lines `persona show` prints. */
export function showLines(_answer: ResolvedPersonaResult): string[] {
  return [];
}

/** The lines `persona subagents` prints. */
export function subagentsLines(_answer: PersonaSubagents): string[] {
  return [];
}
