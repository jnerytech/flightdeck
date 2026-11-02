// Phase 20: the persona model, shared by the daemon (which keeps the host's and the projects'
// personas) and the app (which keeps the global ones), so both check a persona the same way.
import type { PermissionMode, PersonaFields } from "./index.ts";
import { hasControl, type SecretScanner } from "./snippets.ts";

/** A persona as the daemon keeps it: every optional field is `null` when absent. */
export type PersonaDef = PersonaFields;

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON = /^[a-z0-9-]{1,30}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
// A tool is a plain name (or an MCP tool/server), never a permission rule such as `Bash(rm:*)`.
const TOOL =
  /^(?:[A-Za-z][A-Za-z0-9_]{0,63}|mcp__[A-Za-z0-9_-]{1,100}(?:__[A-Za-z0-9_-]{1,100})?)$/;
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
