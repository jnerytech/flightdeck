/**
 * Phase 17: the declared actions. An action is a command the user wrote, with marked places for
 * secrets and for parameters; Claude calls it by name and only picks the parameters allowed. The
 * rules here are what keeps a secret out of a process list and a parameter out of the code an
 * interpreter reads, so a loose `pattern` can never turn an action into a free command.
 */

import type { RuleIssue } from "@flightdeck/protocol";

type ActionIssue = RuleIssue;

export type ApprovalMode = "always" | "never" | "first-per-session";

export interface ActionParam {
  pattern: string;
  default?: string;
}

export interface ActionDef {
  name: string;
  description: string;
  /** Which host runs it (the daemon of that host keeps it). */
  host?: string;
  /** The SSH destination of phase 15, when it runs on a remote host. */
  ssh?: string;
  /** The program and its arguments; never a shell line. */
  run: string[];
  cwd?: string;
  env: Record<string, string>;
  params: Record<string, ActionParam>;
  timeoutS: number;
  approval?: ApprovalMode;
  /** Labels such as `prod`; the usage rules of phase 19 match on them. */
  tags?: string[];
}

export interface ParseOptions {
  /** The secrets the app has; a reference to another one is an error. */
  secretIds?: ReadonlySet<string>;
}

const FIELDS = new Set([
  "name",
  "description",
  "host",
  "ssh",
  "run",
  "cwd",
  "env",
  "params",
  "timeoutS",
  "approval",
  "tags",
]);
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Where a secret or a parameter goes: `{{secret.x}}`, `{{secretFile.x}}`, `{{param.x}}`. */
export const REFERENCE = /\{\{\s*(secret|secretFile|param)\.([A-Za-z0-9._-]+)\s*\}\}/g;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 3600;

/** After these an interpreter reads code. `all` is whether every later argument is code too. */
const CODE_FLAGS: Record<string, { all: boolean }> = {
  "-c": { all: false },
  "-e": { all: false },
  "/c": { all: true },
  "-command": { all: true },
  "-encodedcommand": { all: true },
  eval: { all: true },
};

interface Reference {
  kind: "secret" | "secretFile" | "param";
  name: string;
}

function referencesIn(text: string): Reference[] {
  return [...text.matchAll(REFERENCE)].map((m) => ({
    kind: m[1] as Reference["kind"],
    name: m[2] as string,
  }));
}

const isText = (value: unknown): value is string => typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The whole of a value has to match: a pattern with no anchors does not let a part through. */
export function paramRegex(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`);
}

/** The secret ids an action refers to, as values (env) and as temporary files. */
export function secretsOf(action: ActionDef): { values: string[]; files: string[] } {
  const texts = [...action.run, ...(action.cwd ? [action.cwd] : []), ...Object.values(action.env)];
  const refs = texts.flatMap(referencesIn);
  const unique = (kind: Reference["kind"]) =>
    [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.name))].sort();
  return { values: unique("secret"), files: unique("secretFile") };
}

/** `always`, `never` or `first-per-session`: the default depends on whether it uses a secret. */
export function approvalOf(action: ActionDef): ApprovalMode {
  if (action.approval) return action.approval;
  const { values, files } = secretsOf(action);
  return values.length + files.length > 0 ? "first-per-session" : "never";
}

/** Whether the tags mark production (the protocol's one rule). */
export { isProd } from "@flightdeck/protocol";

const TAG = /^[\p{L}\p{N}-]{1,32}$/u;
const MAX_TAGS = 8;

/** The mistakes of one action, or the action once it is valid. */
export function validateAction(
  raw: unknown,
  opts: ParseOptions = {},
): { action: ActionDef | null; errors: string[]; issues: ActionIssue[] } {
  if (!isRecord(raw)) {
    return {
      action: null,
      errors: ["the action must be an object"],
      issues: [{ path: "", code: "not_object" }],
    };
  }
  const label = isText(raw.name) && raw.name ? `action ${raw.name}` : "action";
  const path = isText(raw.name) ? raw.name : "";
  const errors: string[] = [];
  const issues: ActionIssue[] = [];
  const bad = (code: string, message: string, params?: Record<string, string | number>) => {
    errors.push(`${label}: ${message}`);
    issues.push({ path, code, ...(params ? { params } : {}) });
  };

  for (const key of Object.keys(raw))
    if (!FIELDS.has(key)) bad("unknown_field", `unknown field: ${key}`, { field: key });
  if (!isText(raw.name) || !NAME.test(raw.name)) {
    bad("name_format", "name takes lowercase letters, digits and hyphens, up to 63 characters");
  }
  if (!isText(raw.description) || !raw.description.trim())
    bad("description_required", "description is required");
  for (const key of ["host", "ssh", "cwd"] as const) {
    if (raw[key] !== undefined && !isText(raw[key]))
      bad("field_text", `${key} is a text`, { field: key });
  }

  const run = raw.run;
  const argv = Array.isArray(run) && run.length > 0 && run.every(isText) ? (run as string[]) : null;
  if (!argv)
    bad("run_list", "run is a list of texts (the program and its arguments), never a shell line");

  const env = isRecord(raw.env) ? raw.env : {};
  if (raw.env !== undefined && !isRecord(raw.env)) bad("env_map", "env is a map of NAME to value");
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME.test(key) || !isText(value))
      bad("env_entry", `env ${key} needs a variable name and a text`, { key });
  }

  const params: Record<string, ActionParam> = {};
  const rawParams = isRecord(raw.params) ? raw.params : {};
  if (raw.params !== undefined && !isRecord(raw.params))
    bad("params_map", "params is a map of name to rule");
  for (const [key, spec] of Object.entries(rawParams)) {
    const pattern = isRecord(spec) ? spec.pattern : undefined;
    if (!isText(pattern) || pattern === "") {
      bad("param_pattern_missing", `parameter ${key} needs a pattern`, { param: key });
      continue;
    }
    let regex: RegExp | null = null;
    try {
      regex = paramRegex(pattern);
    } catch {
      bad("param_regex_invalid", `the pattern of parameter ${key} is not a valid regex`, {
        param: key,
      });
      continue;
    }
    const given = (spec as Record<string, unknown>).default;
    if (given !== undefined && (!isText(given) || !regex.test(given))) {
      bad("param_default_mismatch", `the default of parameter ${key} does not match the pattern`, {
        param: key,
      });
      continue;
    }
    params[key] = { pattern, ...(given !== undefined ? { default: given as string } : {}) };
  }

  if (raw.timeoutS !== undefined) {
    const seconds = raw.timeoutS;
    if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > MAX_TIMEOUT_S
    ) {
      bad("timeout_range", `timeoutS is an integer from 1 to ${MAX_TIMEOUT_S}`, {
        max: MAX_TIMEOUT_S,
      });
    }
  }
  if (
    raw.approval !== undefined &&
    raw.approval !== "always" &&
    raw.approval !== "never" &&
    raw.approval !== "first-per-session"
  ) {
    bad("approval_values", "approval is always, never or first-per-session");
  }

  let tags: string[] | undefined;
  if (raw.tags !== undefined) {
    const given = raw.tags;
    if (
      !Array.isArray(given) ||
      given.length > MAX_TAGS ||
      !given.every((tag) => isText(tag) && TAG.test(tag))
    ) {
      bad("tags_list", `tags is a list of up to ${MAX_TAGS} short labels, no spaces (like prod)`, {
        max: MAX_TAGS,
      });
    } else {
      tags = [...new Set((given as string[]).map((tag) => tag.toLowerCase()))];
    }
  }

  if (argv) {
    for (const [i, arg] of argv.entries()) {
      if (referencesIn(arg).some((r) => r.kind === "secret")) {
        bad(
          "secret_in_arg",
          `a secret cannot go in an argument (it shows in the process list): "${arg}"; use env or secretFile`,
          { arg },
        );
      }
      if (i === 0 && referencesIn(arg).some((r) => r.kind === "param")) {
        bad("exec_param", "the executable (run[0]) cannot be a parameter");
      }
    }
    argv.forEach((arg, i) => {
      const flag = CODE_FLAGS[arg.trim().toLowerCase()];
      if (!flag) return;
      const codeArgs = flag.all ? argv.slice(i + 1) : argv.slice(i + 1, i + 2);
      if (codeArgs.some((code) => referencesIn(code).some((r) => r.kind === "param"))) {
        bad(
          "param_in_code",
          `{{param}} cannot take the code position of an interpreter (after ${arg})`,
          { arg },
        );
      }
    });
  }
  if (isText(raw.cwd) && referencesIn(raw.cwd).some((r) => r.kind !== "param")) {
    bad("cwd_secret", "cwd cannot carry a secret");
  }

  const texts = [
    ...(argv ?? []),
    ...(isText(raw.cwd) ? [raw.cwd] : []),
    ...Object.values(env).filter(isText),
  ];
  for (const ref of texts.flatMap(referencesIn)) {
    if (ref.kind === "param" && !(ref.name in params)) {
      bad("param_undeclared", `parameter ${ref.name} is used and was not declared`, {
        param: ref.name,
      });
    }
    if (ref.kind !== "param" && opts.secretIds && !opts.secretIds.has(ref.name)) {
      bad("secret_unknown", `secret ${ref.name} is not in the vault`, { secret: ref.name });
    }
  }

  if (
    isText(raw.ssh) &&
    texts.some((text) => referencesIn(text).some((r) => r.kind === "secretFile"))
  ) {
    bad(
      "ssh_secret_file",
      "an ssh action has no secretFile: it would be a local path in a remote command; use env",
    );
  }

  if (errors.length > 0 || !argv) return { action: null, errors, issues };
  const action: ActionDef = {
    name: raw.name as string,
    description: (raw.description as string).trim(),
    run: argv,
    env: env as Record<string, string>,
    params,
    timeoutS: (raw.timeoutS as number | undefined) ?? DEFAULT_TIMEOUT_S,
    ...(isText(raw.host) ? { host: raw.host } : {}),
    ...(isText(raw.ssh) ? { ssh: raw.ssh } : {}),
    ...(isText(raw.cwd) ? { cwd: raw.cwd } : {}),
    ...(raw.approval ? { approval: raw.approval as ApprovalMode } : {}),
    ...(tags ? { tags } : {}),
  };
  return { action, errors, issues };
}

/** An `actions.yaml`: the valid actions, and the errors of the others. */
export function parseActions(
  yaml: string,
  opts: ParseOptions = {},
): { actions: ActionDef[]; errors: string[]; issues: ActionIssue[] } {
  let document: unknown;
  try {
    document = Bun.YAML.parse(yaml);
  } catch (error) {
    const detail = (error as Error).message;
    return {
      actions: [],
      errors: [`invalid YAML: ${detail}`],
      issues: [{ path: "", code: "yaml_invalid", params: { detail } }],
    };
  }
  if (document === null || document === undefined) return { actions: [], errors: [], issues: [] };
  if (!Array.isArray(document)) {
    return {
      actions: [],
      errors: ["the actions file is a list of actions"],
      issues: [{ path: "", code: "file_not_list" }],
    };
  }
  const actions: ActionDef[] = [];
  const errors: string[] = [];
  const issues: ActionIssue[] = [];
  const names = new Set<string>();
  for (const raw of document) {
    const result = validateAction(raw, opts);
    errors.push(...result.errors);
    issues.push(...result.issues);
    if (!result.action) continue;
    if (names.has(result.action.name)) {
      errors.push(`action ${result.action.name}: duplicate name`);
      issues.push({ path: result.action.name, code: "name_duplicate" });
      continue;
    }
    names.add(result.action.name);
    actions.push(result.action);
  }
  return { actions, errors, issues };
}
