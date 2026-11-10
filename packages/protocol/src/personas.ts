// Phase 20: the persona model, shared by the daemon (which keeps the host's and the projects'
// personas) and the app (which keeps the global ones), so both check a persona the same way.

import { z } from "zod";
import { cmd } from "./command.ts";
import { PermissionMode } from "./permissions.ts";
import { hasControl, type SecretScanner } from "./snippets.ts";

const PersonaEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);

/** What the form sends for a persona (phase 20): a role the Claude takes, with its suggestions. */
export const PersonaInput = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    model: z.string().optional(),
    effort: PersonaEffort.optional(),
    /** Only restricts: the tools the persona may use; absent means the session's own. */
    tools: z.array(z.string()).optional(),
    /** A suggestion, never above the session's mode. */
    permissionMode: PermissionMode.optional(),
    /** The text added to the system prompt, at most 8 KB and with no secret. */
    body: z.string(),
  })
  .strict();
export type PersonaInput = z.infer<typeof PersonaInput>;

/** A persona in its normal form: every optional field is `null` when absent. */
export const PersonaFields = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  model: z.string().nullable(),
  effort: PersonaEffort.nullable(),
  tools: z.array(z.string()).nullable(),
  permissionMode: PermissionMode.nullable(),
  body: z.string(),
});
export type PersonaFields = z.infer<typeof PersonaFields>;

/** The persona of a session, as the lists and the timeline show it. */
export const SessionPersona = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
export type SessionPersona = z.infer<typeof SessionPersona>;

/**
 * Which persona to use: an `id` (the project's, else the host's, else the pack's) or a whole
 * `definition` (the app's global ones live in the app). `language` picks the pack's language.
 */
export const PersonaRef = z
  .object({
    id: z.string().optional(),
    definition: PersonaInput.optional(),
    language: z.enum(["pt-BR", "en"]).optional(),
  })
  .strict()
  .refine((ref) => (ref.id === undefined) !== (ref.definition === undefined), {
    message: "give id or definition, one of the two",
  });
export type PersonaRef = z.infer<typeof PersonaRef>;

/** A persona as the daemon keeps it: every optional field is `null` when absent. */
export type PersonaDef = PersonaFields;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON = /^[a-z0-9-]{1,30}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
// A tool is a plain name (or an MCP tool/server), never a permission rule such as `Bash(rm:*)`.
const TOOL = /^(?:[A-Za-z]\w{0,63}|mcp__[\w-]{1,100}(?:__[\w-]{1,100})?)$/;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** `bypassPermissions` cannot be suggested: a persona never asks for fewer checks. */
const MODES = ["default", "acceptEdits", "plan", "dontAsk", "auto"] as const;
const KEYS = new Set([
  "id",
  "name",
  "description",
  "icon",
  "model",
  "effort",
  "tools",
  "permissionMode",
  "body",
]);
const MAX_BODY_BYTES = 8192;
const MAX_TOOLS = 50;

/**
 * Why the model refused a persona: `bad_request`, or `persona_secret` (instructions never carry a
 * secret). The daemon answers it as a protocol error with the same code.
 */
export class PersonaModelError extends Error {
  constructor(
    readonly code: "bad_request" | "persona_secret",
    message: string,
    /** Why, for the app to translate: a stable key and the values its text fills in. */
    readonly reason: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

const badRequest = (message: string, reason: string, params?: Record<string, string | number>) =>
  new PersonaModelError("bad_request", message, reason, params);

function text(raw: Record<string, unknown>, key: string, max: number, multiline = false): string {
  const value = raw[key];
  if (typeof value !== "string") {
    throw badRequest(`${key} is required`, "persona_field_required", { field: key });
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max || hasControl(trimmed, "")) {
    throw badRequest(
      `${key}: 1 to ${max} characters${multiline ? "" : ", on a single line"}`,
      multiline ? "persona_field_length" : "persona_field_line",
      { field: key, max },
    );
  }
  return trimmed;
}

function optional(raw: Record<string, unknown>, key: string, pattern: RegExp): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw badRequest(`${key} is not valid`, "persona_field_invalid", { field: key });
  }
  return value;
}

/** Checks a persona (from the form, a file or a workflow) and returns it in its normal form. */
export function normalizePersona(raw: unknown, scanner: Pick<SecretScanner, "scan">): PersonaDef {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("a persona must be an object", "persona_not_object");
  }
  const fields = raw as Record<string, unknown>;
  const unknown = Object.keys(fields).find((key) => !KEYS.has(key));
  if (unknown)
    throw badRequest(`unknown field: ${unknown}`, "persona_field_unknown", { field: unknown });
  const id = fields.id;
  if (typeof id !== "string" || !ID.test(id)) {
    throw badRequest(
      "id: lowercase letters, digits and hyphens, 1 to 40 (it becomes a file and agent name)",
      "persona_id_format",
    );
  }
  const name = text(fields, "name", 60);
  const description = text(fields, "description", 200);
  const effort = fields.effort ?? null;
  if (effort !== null && !(EFFORTS as readonly unknown[]).includes(effort)) {
    throw badRequest(`effort: ${EFFORTS.join(", ")}`, "persona_effort", {
      values: EFFORTS.join(", "),
    });
  }
  const mode = fields.permissionMode ?? null;
  if (mode !== null && !(MODES as readonly unknown[]).includes(mode)) {
    throw badRequest(`permissionMode: ${MODES.join(", ")}`, "persona_mode", {
      values: MODES.join(", "),
    });
  }
  const body = typeof fields.body === "string" ? fields.body.trim() : "";
  if (body === "") throw badRequest("the persona's body cannot be empty", "persona_body_empty");
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    throw badRequest("the body is over 8 KB", "persona_body_big");
  if (hasControl(body, "\t\n\r")) {
    throw badRequest("the body has control characters", "persona_body_control");
  }
  const kinds = [...new Set([name, description, body].flatMap((part) => scanner.scan(part)))];
  if (kinds.length > 0) {
    throw new PersonaModelError(
      "persona_secret",
      `the persona has a secret (${kinds.join(", ")}): instructions carry no secrets`,
      "persona_has_secret",
      { kinds: kinds.join(", ") },
    );
  }
  return {
    id,
    name,
    description,
    icon: optional(fields, "icon", ICON),
    model: optional(fields, "model", MODEL),
    effort: effort as PersonaDef["effort"],
    tools: toolList(fields.tools),
    permissionMode: mode as PersonaDef["permissionMode"],
    body,
  };
}

function toolList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > MAX_TOOLS)
    throw badRequest("tools: a list of up to 50 names", "persona_tools_list");
  if (
    raw.some((tool) => typeof tool !== "string" || !TOOL.test(tool)) ||
    new Set(raw).size !== raw.length
  ) {
    throw badRequest(
      "tools: plain tool names, with no repeats and no permission rules",
      "persona_tools_names",
    );
  }
  return raw as string[];
}

/** A persona's tools can only take away from the session's: the intersection, never more. */
export function restrictTools(persona: string[] | null, session: string[] | null): string[] | null {
  if (persona === null) return session;
  if (session === null) return persona;
  return persona.filter((tool) => session.includes(tool));
}

/** Whether `tool` is among the persona's (an MCP server named alone covers all its tools). */
export function toolAllowed(persona: string[] | null, tool: string): boolean {
  return (
    persona === null ||
    persona.some(
      (name) => name === tool || (name.startsWith("mcp__") && tool.startsWith(`${name}__`)),
    )
  );
}

/** How permissive a mode is; `acceptEdits` and `auto` share a rank because they cannot be compared. */
const RANK: Record<PermissionMode, number> = {
  plan: 0,
  dontAsk: 1,
  default: 2,
  acceptEdits: 3,
  auto: 3,
  bypassPermissions: 4,
};

/** What the persona suggests only counts when it is clearly less permissive than the session's mode. */
export function clampPermissionMode(
  suggested: PermissionMode | null,
  session: PermissionMode,
): PermissionMode {
  return suggested !== null && RANK[suggested] < RANK[session] ? suggested : session;
}

/** Which personas become subagents in a project: the pack and the project's, only the project's, or none. */
export const PersonaSubagentsMode = z.enum(["all", "project", "none"]);
export type PersonaSubagentsMode = z.infer<typeof PersonaSubagentsMode>;

/** A persona of this host: where it lives, the hash of a versioned file and whether it is trusted. */
export const Persona = PersonaFields.extend({
  scope: z.enum(["pack", "host", "project"]),
  /** The SHA-256 of the project's file; `null` for the others. */
  hash: z.string().nullable(),
  /** A project persona is trusted once its hash is; the others always are. */
  trusted: z.boolean(),
  /** A pack persona the host has edited. */
  modified: z.boolean(),
});
export type Persona = z.infer<typeof Persona>;

/** A persona as a subagent: what the SDK's `agents` and claude's `--agents` take. */
export const PersonaAgent = z.object({
  description: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
});
export type PersonaAgent = z.infer<typeof PersonaAgent>;

/** The agents `persona-<id>` of a project, and the versioned personas left out for lack of trust. */
export const PersonaSubagents = z.object({
  agents: z.record(z.string(), PersonaAgent),
  untrusted: z.array(z.string()),
});
export type PersonaSubagents = z.infer<typeof PersonaSubagents>;

/** What applying or leaving a persona answers: the persona and the message that was sent. */
export const PersonaSwitchResult = z.object({
  persona: SessionPersona,
  text: z.string(),
  /**
   * How the message went: `sent` to an idle managed session, `queued` behind a turn or a pending
   * request, `terminal` to a terminal session's channel (it shows when Claude takes it). Absent
   * from an older host.
   */
  delivery: z.enum(["sent", "queued", "terminal"]).optional(),
});
export type PersonaSwitchResult = z.infer<typeof PersonaSwitchResult>;

/** The project's `.flightdeck/personas` folder and the files in it that were left out. */
export const PersonaProjectInfo = z.object({ path: z.string(), errors: z.array(z.string()) });
export type PersonaProjectInfo = z.infer<typeof PersonaProjectInfo>;

/** A persona ready to use, with where it came from. */
export const ResolvedPersonaResult = z.object({
  persona: PersonaFields,
  source: z.enum(["project", "host", "pack", "inline"]),
  /** The hash of the versioned file, for the ones from a project. */
  hash: z.string().nullable(),
});
export type ResolvedPersonaResult = z.infer<typeof ResolvedPersonaResult>;

/** The personas commands; index.ts spreads them into `Command`. */
export const personasCommands = [
  /** The personas of the host and, with `projectPath`, of that project. */
  cmd(
    "personas.list",
    z
      .object({
        scope: z.enum(["host", "project", "all"]).optional(),
        projectPath: z.string().optional(),
        /** The language of the pack personas that are shown (`pt-BR` when absent). */
        language: z.enum(["pt-BR", "en"]).optional(),
      })
      .strict(),
  ),
  /** Creates or edits a persona; a secret in it is refused with `persona_secret`. */
  cmd(
    "personas.save",
    z
      .object({
        scope: z.enum(["host", "project"]),
        projectPath: z.string().optional(),
        persona: PersonaInput,
      })
      .strict(),
  ),
  cmd(
    "personas.remove",
    z
      .object({
        scope: z.enum(["host", "project"]),
        id: z.string(),
        projectPath: z.string().optional(),
      })
      .strict(),
  ),
  /** The personas that hold in the project, as the agents `persona-<id>` a session can call. */
  cmd(
    "personas.subagents",
    z
      .object({
        projectPath: z.string().optional(),
        language: z.enum(["pt-BR", "en"]).optional(),
      })
      .strict(),
  ),
  /** Writes a persona as the project agent `.claude/agents/persona-<id>.md`; asks for `confirm`. */
  cmd(
    "personas.publishAgent",
    z
      .object({
        id: z.string(),
        projectPath: z.string(),
        language: z.enum(["pt-BR", "en"]).optional(),
        confirm: z.boolean(),
      })
      .strict(),
  ),
  /** The persona to use, as `session.create` and `flightdeckd claude --persona` would resolve it. */
  cmd(
    "personas.resolve",
    z.object({ ref: PersonaRef, projectPath: z.string().optional() }).strict(),
  ),
  /** Puts a pack persona back as it came (the host's edit goes away). */
  cmd(
    "personas.reset",
    z.object({ id: z.string(), language: z.enum(["pt-BR", "en"]).optional() }).strict(),
  ),
  /** Trusts a project's versioned persona, by the hash `personas.list` showed. */
  cmd(
    "personas.trust",
    z.object({ projectPath: z.string(), id: z.string(), hash: z.string() }).strict(),
  ),
] as const;

/** The `data` of each personas command's ack; `CommandResults` extends it. */
export interface PersonasResults {
  "personas.list": { personas: Persona[]; project: PersonaProjectInfo | null };
  "personas.save": Persona;
  "personas.remove": undefined;
  "personas.reset": Persona;
  "personas.resolve": ResolvedPersonaResult;
  "personas.subagents": PersonaSubagents;
  "personas.publishAgent": { path: string };
  "personas.trust": Persona;
}
