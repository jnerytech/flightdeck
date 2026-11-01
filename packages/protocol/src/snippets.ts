// Phase 18: the snippet model, shared by the daemon (which keeps snippets) and the app (which keeps
// the global ones), so both check a snippet the same way.
import type { SnippetField, SnippetInput, SnippetVar } from "./index.ts";

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
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
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
    const code = char.charCodeAt(0);
    return (code < 32 || code === 127) && !allow.includes(char);
  });
}

// -- secrets ---------------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["token do GitHub", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ["chave sk-", /\bsk-[A-Za-z0-9_-]{16,}/g],
  ["chave da AWS", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["chave privada", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["token Bearer", /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi],
  ["token do Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  [
    "senha na linha",
    /\b(?:password|passwd|pwd|pass|secret|token|api[_-]?key|apikey|access[_-]?key)\s*[=:]\s*['"]?[^\s'"&;]{3,}/gi,
  ],
  ["credencial em URL", /:\/\/[^\s/:@]+:[^\s/@]+@/g],
];

/** Vault values shorter than this are not told apart from ordinary text. */
const MIN_VAULT_VALUE = 6;

/**
 * Looks for secrets in text: token shapes, private keys, passwords typed on the line and, when
 * the vault is connected (phase 16), its values. It names what it found and never repeats it.
 * A `{{variable}}` is not a secret: it is where the value will be put when the snippet is used.
 */
export class SecretScanner {
  constructor(private readonly vaultValues: () => string[] = () => []) {}

  scan(text: string): string[] {
    const found: string[] = [];
    for (const [label, pattern] of SECRET_PATTERNS) {
      const hit = [...text.matchAll(pattern)].some((match) => !match[0].includes("{{"));
      if (hit) found.push(label);
    }
    if (
      this.vaultValues().some((value) => value.length >= MIN_VAULT_VALUE && text.includes(value))
    ) {
      found.push("valor do cofre");
    }
    return found;
  }
}

// -- the model -------------------------------------------------------------------------------

/** The names between `{{ }}`, in order of appearance and without repeats. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string))];
}

function template(def: SnippetDef): string {
  return (def.type === "command" ? def.run : def.text) as string;
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
  const vars = input.vars ?? {};
  const used = placeholders(body);
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
  const tags = [
    ...new Set((input.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag !== "")),
  ];
  if (tags.length > MAX_TAGS) {
    throw badRequest("too_many_tags", `at most ${MAX_TAGS} tags`, { max: MAX_TAGS });
  }
  for (const tag of tags) {
    if (tag.length > 30 || tag.includes(",") || hasControl(tag, "")) {
      throw badRequest("tag_invalid", "invalid tag");
    }
  }
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
