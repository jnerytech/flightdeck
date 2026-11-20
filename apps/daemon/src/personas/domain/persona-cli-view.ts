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

/** How much of a project persona's hash a line shows: enough to tell two apart. */
const HASH_SHOWN = 12;

/** The lines `persona list` prints: one per persona, then the project files that were left out. */
export function listLines(answer: {
  personas: Persona[];
  project: PersonaProjectInfo | null;
}): string[] {
  if (answer.personas.length === 0) return ["no personas"];
  const rows = answer.personas.map((persona) => {
    const parts = [persona.id, persona.scope, persona.name];
    if (persona.modified) parts[2] += "  (edited)";
    if (persona.scope === "project") {
      if (persona.hash !== null) parts.push(persona.hash.slice(0, HASH_SHOWN));
      if (!persona.trusted) parts.push("not trusted");
    }
    return parts.join("  ");
  });
  const left = answer.project?.errors ?? [];
  const tail = left.length === 0 ? [] : [`left out of ${answer.project?.path}: ${left.join("; ")}`];
  return [...rows, ...tail];
}

/** The lines `persona show` prints: the header, the settings the persona sets, then its prompt. */
export function showLines({ persona, source }: ResolvedPersonaResult): string[] {
  return [
    `${persona.id}  ${persona.name}  (${source})`,
    ...(persona.description ? [persona.description] : []),
    ...(persona.model ? [`model: ${persona.model}`] : []),
    ...(persona.effort ? [`effort: ${persona.effort}`] : []),
    ...(persona.tools ? [`tools: ${persona.tools.join(", ")}`] : []),
    ...(persona.permissionMode ? [`permission mode: ${persona.permissionMode}`] : []),
    "",
    ...persona.body.split("\n"),
  ];
}

/** The lines `persona subagents` prints: each agent, then the versioned personas left out. */
export function subagentsLines({ agents, untrusted }: PersonaSubagents): string[] {
  const rows = Object.entries(agents).map(([name, agent]) => `${name}  ${agent.description}`);
  const tail = untrusted.length === 0 ? [] : [`not trusted, left out: ${untrusted.join(", ")}`];
  return rows.length + tail.length === 0 ? ["no subagents"] : [...rows, ...tail];
}
