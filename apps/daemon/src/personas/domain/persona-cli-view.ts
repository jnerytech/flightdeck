/**
 * Issue #3456: what `flightdeckd persona list|show|subagents` says, as pure rules over the daemon's
 * answers. The daemon calls and the exit codes stay in `personas/persona-cli.ts`.
 */
import type {
  Persona,
  PersonaInput,
  PersonaProjectInfo,
  PersonaSubagents,
  ResolvedPersonaResult,
} from "@flightdeck/protocol";

export interface PersonaCliArgs {
  action: "list" | "show" | "subagents" | "save" | "remove" | "reset" | "publish-agent";
  /** `show`, `save`, `remove`, `reset`, `publish-agent`: the persona's id. */
  id?: string;
  /** `save`: the persona's fields. */
  name?: string;
  description?: string;
  body?: string;
  bodyFile?: string;
  model?: string;
  effort?: PersonaInput["effort"];
  tools?: string[];
  permissionMode?: PersonaInput["permissionMode"];
  icon?: string;
  /** `publish-agent --confirm`. */
  confirm?: boolean;
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
  return [...(rows.length === 0 ? ["no personas"] : rows), ...tail];
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

/** The persona `persona save` sends: the flags that were given, with the body already read. */
export function personaOf(args: PersonaCliArgs, body: string): PersonaInput {
  return {
    id: args.id ?? "",
    name: args.name ?? "",
    description: args.description ?? "",
    body,
    ...(args.icon === undefined ? {} : { icon: args.icon }),
    ...(args.model === undefined ? {} : { model: args.model }),
    ...(args.effort === undefined ? {} : { effort: args.effort }),
    ...(args.tools === undefined ? {} : { tools: args.tools }),
    ...(args.permissionMode === undefined ? {} : { permissionMode: args.permissionMode }),
  };
}

/** What a change that got no answer may have done: the next step is to look, not to repeat it. */
export const UNSURE =
  "; the change may or may not have gone in: check with `persona list` before trying again";

/** `publish-agent` writes a file into the project: the daemon asks for the person's yes, and so does this. */
export function publishRefusal(args: PersonaCliArgs): string {
  return `persona publish-agent writes .claude/agents/persona-${args.id ?? ""}.md into the project and cannot be undone: pass --confirm to do it`;
}
