// Phase 18: the snippet model, shared by the daemon (which keeps snippets) and the app (which keeps
// the global ones), so both check a snippet the same way.

import { z } from "zod";
import { cmd } from "./command.ts";
import type { SecretScanner } from "./secret-scanner.ts";
import { TerminalCols, type TerminalInfo, TerminalRows } from "./terminal.ts";

// Issue #1626: the snippet schemas live here, so this file never imports index.ts (a load-time cycle).
/** How a snippet variable is filled in: a default value and a short list of options. */
export const SnippetVar = z
  .object({
    default: z.string().max(1000).optional(),
    options: z.array(z.string().max(200)).optional(),
  })
  .strict();
export type SnippetVar = z.infer<typeof SnippetVar>;

/**
 * What the form sends for a snippet (phase 18): a `command` (`run`, one line) or a `prompt`
 * (`text`), with `{{name}}` variables. A snippet carries no secret.
 */
export const SnippetInput = z
  .object({
    name: z.string(),
    type: z.enum(["command", "prompt"]),
    run: z.string().optional(),
    text: z.string().optional(),
    vars: z.record(z.string(), SnippetVar).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();
export type SnippetInput = z.infer<typeof SnippetInput>;

/** A field to fill in when a snippet is used. The specials (`cwd`, `branch`, `file`, `selection`) come from the context. */
export const SnippetField = z.object({
  name: z.string(),
  special: z.boolean(),
  default: z.string().nullable(),
  options: z.array(z.string()),
});
export type SnippetField = z.infer<typeof SnippetField>;

/** A snippet as the daemon keeps it: the template and what the form needs, without the scope. */
export interface SnippetDef {
  name: string;
  type: "command" | "prompt";
  /** The command template; `null` for a prompt. */
  run: string | null;
  /** The prompt template; `null` for a command. */
  text: string | null;
  vars: Record<string, SnippetVar>;
  tags: string[];
}

/** Filled from where the snippet is used, never declared by the snippet. */
export const SPECIAL_VARS = ["cwd", "branch", "file", "selection"] as const;

export interface SnippetContext {
  cwd?: string;
  branch?: string;
  file?: string;
  selection?: string;
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;
const VAR_NAME = /^[A-Za-z_]\w*$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;
const MAX_COMMAND = 4000;
const MAX_PROMPT = 20_000;
const MAX_TAGS = 10;
const MAX_OPTIONS = 50;

/** Every `reason` a refusal of the model can carry: the app has a text for each, in both languages. */
export const SNIPPET_REASONS = [
  "name_invalid",
  "needs_run",
  "needs_text",
  "no_text",
  "no_run",
  "too_big",
  "control_command",
  "control_prompt",
  "var_name",
  "var_special",
  "var_unused",
  "too_many_tags",
  "tag_invalid",
  "too_many_options",
  "options_plain",
  "default_control",
  "default_not_option",
  "value_control",
  "value_not_option",
  "missing_values",
  "name_taken",
  "not_found",
  "secret",
] as const;
export type SnippetReason = (typeof SNIPPET_REASONS)[number];

/** What a reason's text fills in: a variable's name, a limit, the options. */
export type SnippetParams = Record<string, string | number>;

/**
 * Why the model refused a snippet: `bad_request`, or `snippet_secret` (the app then offers to
 * turn it into an action). The daemon answers it as a protocol error with the same code. The
 * `reason` (with its `params`) is what the app translates; the message is English, for logs and
 * the CLI.
 */
export class SnippetModelError extends Error {
  constructor(
    readonly code: "bad_request" | "snippet_secret",
    message: string,
    readonly reason: SnippetReason,
    readonly params: SnippetParams = {},
  ) {
    super(message);
  }
}

const badRequest = (reason: SnippetReason, message: string, params: SnippetParams = {}) =>
  new SnippetModelError("bad_request", message, reason, params);

/** Control characters other than the ones `allow` lets through (tab for a command, tab and lines for a prompt). */
export function hasControl(text: string, allow: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 32 || code === 127) && !allow.includes(char);
  });
}
// The secret scanner lives in its own file; this file re-exports it and keeps using it below.
export * from "./secret-scanner.ts";

// -- the model -------------------------------------------------------------------------------

/** The names between `{{ }}`, in order of appearance and without repeats. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string))];
}

function template(def: SnippetDef): string {
  return (def.type === "command" ? def.run : def.text) as string;
}

/** The command or the text of a snippet, once it is the right one, short enough and clean. */
function checkedBody(input: SnippetInput, isCommand: boolean): string {
  const body = isCommand ? input.run : input.text;
  if (body === undefined || body === "") {
    throw isCommand
      ? badRequest("needs_run", "a command needs run")
      : badRequest("needs_text", "a prompt needs text");
  }
  if ((isCommand ? input.text : input.run) !== undefined) {
    throw isCommand
      ? badRequest("no_text", "a command takes no text")
      : badRequest("no_run", "a prompt takes no run");
  }
  if (body.length > (isCommand ? MAX_COMMAND : MAX_PROMPT)) {
    throw badRequest("too_big", "snippet too big");
  }
  if (hasControl(body, isCommand ? "\t" : "\t\n\r")) {
    throw isCommand
      ? badRequest("control_command", "a command is one line, without control characters")
      : badRequest("control_prompt", "control characters in the text");
  }
  return body;
}

/** Every variable has a valid name, is not a special one, is used in the body and has a valid spec. */
function checkVars(vars: NonNullable<SnippetInput["vars"]>, used: string[]): void {
  for (const [key, spec] of Object.entries(vars)) {
    if (!VAR_NAME.test(key)) {
      throw badRequest("var_name", `invalid variable name: ${key}`, { name: key });
    }
    if ((SPECIAL_VARS as readonly string[]).includes(key)) {
      throw badRequest("var_special", `${key} is a special variable: it comes from the context`, {
        name: key,
      });
    }
    if (!used.includes(key)) {
      throw badRequest("var_unused", `variable ${key} is not used in the text`, { name: key });
    }
    checkVar(key, spec);
  }
}

/** The tags trimmed and without repeats, refused when there are too many or one is not valid. */
function checkedTags(raw: string[]): string[] {
  const tags = [...new Set(raw.map((tag) => tag.trim()).filter((tag) => tag !== ""))];
  if (tags.length > MAX_TAGS) {
    throw badRequest("too_many_tags", `at most ${MAX_TAGS} tags`, { max: MAX_TAGS });
  }
  for (const tag of tags) {
    if (tag.length > 30 || tag.includes(",") || hasControl(tag, "")) {
      throw badRequest("tag_invalid", "invalid tag");
    }
  }
  return tags;
}

/**
 * Checks a snippet and returns it in its normal form. A command is one line without control
 * characters, so pasting it cannot run what the person did not see. A snippet with a secret is
 * refused with `snippet_secret`: the app then offers to turn it into an action (phase 17).
 */
export function normalizeSnippet(input: SnippetInput, scanner: SecretScanner): SnippetDef {
  const name = input.name.trim();
  refuseSecrets(scanner, [name, ...(input.tags ?? [])], "the name or the tags have a secret");
  if (!NAME.test(name)) {
    throw badRequest(
      "name_invalid",
      "name must be 1 to 64 characters: letters, numbers, space, . _ -",
    );
  }
  const isCommand = input.type === "command";
  const body = checkedBody(input, isCommand);
  const vars = input.vars ?? {};
  checkVars(vars, placeholders(body));
  const tags = checkedTags(input.tags ?? []);
  const def: SnippetDef = {
    name,
    type: input.type,
    run: isCommand ? body : null,
    text: isCommand ? null : body,
    vars,
    tags,
  };
  // The whole content: the template, and every default and option the form will offer.
  const content = [
    body,
    ...Object.values(vars).flatMap((v) => [v.default ?? "", ...(v.options ?? [])]),
  ];
  refuseSecrets(scanner, content, "the snippet has a secret");
  return def;
}

/** `snippet_secret` naming the kinds found (never the values), so the app can offer to make an action. */
function refuseSecrets(scanner: SecretScanner, texts: string[], what: string): void {
  const secrets = [...new Set(texts.flatMap((text) => scanner.scan(text)))];
  if (secrets.length > 0) {
    throw new SnippetModelError(
      "snippet_secret",
      `${what} (${secrets.join(", ")}): a snippet takes no secret, turn it into an action`,
      "secret",
      { kinds: secrets.join(", ") },
    );
  }
}

function checkVar(key: string, spec: SnippetVar): void {
  const options = spec.options ?? [];
  if (options.length > MAX_OPTIONS) {
    throw badRequest("too_many_options", `too many options in ${key}`, { name: key });
  }
  if (
    options.some((option) => option === "" || hasControl(option, "")) ||
    new Set(options).size !== options.length
  ) {
    throw badRequest("options_plain", `the options of ${key} are plain text, without repeats`, {
      name: key,
    });
  }
  if (spec.default !== undefined && hasControl(spec.default, "")) {
    throw badRequest("default_control", `the default of ${key} has control characters`, {
      name: key,
    });
  }
  if (spec.default !== undefined && options.length > 0 && !options.includes(spec.default)) {
    throw badRequest("default_not_option", `the default of ${key} must be one of the options`, {
      name: key,
    });
  }
}

/** The fields to fill in when the snippet is used, in order of appearance. */
export function fieldsOf(def: SnippetDef): SnippetField[] {
  return placeholders(template(def)).map((name) => {
    const special = (SPECIAL_VARS as readonly string[]).includes(name);
    const spec = special ? undefined : def.vars[name];
    return { name, special, default: spec?.default ?? null, options: spec?.options ?? [] };
  });
}

/**
 * Fills the template: each field takes the given value, else its default, and the specials come
 * from the context. What is missing, or outside the options, is refused, and so is any value
 * that would not be safe to type into a terminal (line breaks and control characters).
 */
export function renderSnippet(
  def: SnippetDef,
  values: Record<string, string>,
  context: SnippetContext,
): string {
  const allow = def.type === "command" ? "\t" : "\t\n\r";
  const missing: string[] = [];
  const resolved = new Map<string, string>();
  for (const field of fieldsOf(def)) {
    const value = field.special
      ? context[field.name as keyof SnippetContext]
      : (values[field.name] ?? field.default ?? undefined);
    if (value === undefined) {
      missing.push(field.name);
      continue;
    }
    if (hasControl(value, allow)) {
      throw badRequest(
        "value_control",
        `the value of ${field.name} has a line break or control characters`,
        { name: field.name },
      );
    }
    if (field.options.length > 0 && !field.options.includes(value)) {
      const options = field.options.join(", ");
      throw badRequest(
        "value_not_option",
        `${field.name}: the value is outside the options (${options})`,
        { name: field.name, options },
      );
    }
    resolved.set(field.name, value);
  }
  if (missing.length > 0) {
    const names = missing.join(", ");
    throw badRequest("missing_values", `missing values: ${names}`, { names });
  }
  // One pass, so a value that looks like a placeholder is not expanded.
  return template(def).replace(PLACEHOLDER, (_all, name: string) => resolved.get(name) as string);
}

export const SnippetScope = z.enum(["host", "project"]);

/** A snippet of this host, from the daemon or from a project's versioned file. */
export const Snippet = z.object({
  /** A ULID for the ones in the daemon; `file:<project>:<name>` for the ones in the file. */
  id: z.string(),
  scope: SnippetScope,
  source: z.enum(["daemon", "file"]),
  projectPath: z.string().nullable(),
  name: z.string(),
  type: z.enum(["command", "prompt"]),
  run: z.string().nullable(),
  text: z.string().nullable(),
  vars: z.record(z.string(), SnippetVar),
  tags: z.array(z.string()),
  fields: z.array(SnippetField),
  favorite: z.boolean(),
  uses: z.number().int(),
  lastUsedAt: z.string().nullable(),
  /** A command from the versioned file runs only when the file is trusted; pasting never needs it. */
  runnable: z.boolean(),
});
export type Snippet = z.infer<typeof Snippet>;

/** The project's versioned `.flightdeck/snippets.yaml`: its hash, whether it is trusted and what was left out. */
export const SnippetFileInfo = z.object({
  path: z.string(),
  hash: z.string(),
  trusted: z.boolean(),
  errors: z.array(z.string()),
});
export type SnippetFileInfo = z.infer<typeof SnippetFileInfo>;

/** A line of the shell history that could become a snippet; a flagged one has no `command` until revealed and is never `selectable`. */
export const SnippetHistoryCandidate = z.object({
  /** Stable for the same command, so the app can say which ones to import. */
  id: z.string(),
  command: z.string().nullable(),
  count: z.number().int(),
  shells: z.array(z.string()),
  /** What the secret scan found (the kinds, never the values). */
  flagged: z.array(z.string()),
  hidden: z.boolean(),
  selectable: z.boolean(),
});
export type SnippetHistoryCandidate = z.infer<typeof SnippetHistoryCandidate>;

export const SnippetHistoryResult = z.object({
  candidates: z.array(SnippetHistoryCandidate),
  sources: z.array(z.object({ shell: z.string(), found: z.boolean() })),
  created: z.array(Snippet),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type SnippetHistoryResult = z.infer<typeof SnippetHistoryResult>;

const SnippetValues = z.record(z.string().max(100), z.string().max(4000));

const SnippetUseContext = z
  .object({
    cwd: z.string().optional(),
    file: z.string().max(4000).optional(),
    selection: z.string().max(20_000).optional(),
  })
  .strict();

/** The snippets commands; index.ts spreads them into `Command`. */
export const snippetsCommands = [
  /** Snippets of the host and, with `projectPath`, of that project, favorites and recents first. */
  cmd(
    "snippets.list",
    z
      .object({
        scope: z.enum(["host", "project", "all"]).optional(),
        projectPath: z.string().optional(),
        query: z.string().optional(),
        tag: z.string().optional(),
        type: z.enum(["command", "prompt"]).optional(),
      })
      .strict(),
  ),
  /** Creates (no `id`) or edits a snippet; a secret in it is refused with `snippet_secret`. */
  cmd(
    "snippets.save",
    z
      .object({
        ...SnippetInput.shape,
        id: z.string().optional(),
        scope: SnippetScope,
        target: z.enum(["daemon", "file"]).optional(),
        projectPath: z.string().optional(),
      })
      .strict(),
  ),
  /** By `id`, or by `name` (the host's, then the `projectPath`'s). */
  cmd(
    "snippets.get",
    z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        projectPath: z.string().optional(),
      })
      .strict()
      .refine((p) => p.id !== undefined || p.name !== undefined, { message: "give id or name" }),
  ),
  cmd("snippets.remove", z.object({ id: z.string() }).strict()),
  /** Trusts the content of the project's versioned file, by the hash `snippets.list` showed. */
  cmd("snippets.trust", z.object({ projectPath: z.string(), hash: z.string() }).strict()),
  cmd("snippets.favorite", z.object({ id: z.string(), favorite: z.boolean() }).strict()),
  /** Reads a YAML or JSON list of snippets (an import from a file); saves nothing. */
  cmd("snippets.parse", z.object({ text: z.string().max(1_000_000) }).strict()),
  /**
   * The most used commands of this host's shell histories (read only, secrets hidden). With
   * `select` (ids of the candidates) it also makes them snippets of the host.
   */
  cmd(
    "snippets.importHistory",
    z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        reveal: z.boolean().optional(),
        select: z.array(z.string()).max(200).optional(),
      })
      .strict(),
  ),
  /** The text a snippet would produce with these values and context, and the fields it asks for. */
  cmd(
    "snippets.render",
    z
      .object({
        id: z.string(),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
      })
      .strict(),
  ),
  /**
   * Uses a snippet: `paste` types a command into a terminal (`enter` also runs it), `run` opens a
   * new tab at `context.cwd`, `send` sends a prompt to a session (`sessionId` or `claudeSessionId`).
   */
  cmd(
    "snippets.use",
    z
      .object({
        id: z.string(),
        action: z.enum(["paste", "run", "send"]),
        values: SnippetValues.optional(),
        context: SnippetUseContext.optional(),
        terminalId: z.string().optional(),
        enter: z.boolean().optional(),
        cols: TerminalCols.optional(),
        rows: TerminalRows.optional(),
        sessionId: z.string().optional(),
        claudeSessionId: z.string().optional(),
      })
      .strict(),
  ),
] as const;

/** The `data` of each snippets command's ack; `CommandResults` extends it. */
export interface SnippetsResults {
  "snippets.list": { snippets: Snippet[]; file: SnippetFileInfo | null };
  "snippets.save": Snippet;
  "snippets.get": Snippet;
  "snippets.remove": undefined;
  "snippets.trust": SnippetFileInfo;
  "snippets.favorite": Snippet;
  "snippets.parse": { snippets: SnippetInput[]; errors: string[] };
  "snippets.importHistory": SnippetHistoryResult;
  "snippets.render": { text: string; fields: SnippetField[] };
  "snippets.use": { text: string; terminal: TerminalInfo | null };
}
