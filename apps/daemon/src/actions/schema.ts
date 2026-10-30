/**
 * Phase 17: the declared actions. An action is a command the user wrote, with marked places for
 * secrets and for parameters; Claude calls it by name and only picks the parameters allowed. The
 * rules here are what keeps a secret out of a process list and a parameter out of the code an
 * interpreter reads, so a loose `pattern` can never turn an action into a free command.
 */

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
): { action: ActionDef | null; errors: string[] } {
  if (!isRecord(raw)) return { action: null, errors: ["a ação tem de ser um objeto"] };
  const label = isText(raw.name) && raw.name ? `ação ${raw.name}` : "ação";
  const errors: string[] = [];
  const bad = (message: string) => errors.push(`${label}: ${message}`);

  for (const key of Object.keys(raw)) if (!FIELDS.has(key)) bad(`campo desconhecido: ${key}`);
  if (!isText(raw.name) || !NAME.test(raw.name)) {
    bad("name tem letras minúsculas, números e hífens, até 63 caracteres");
  }
  if (!isText(raw.description) || !raw.description.trim()) bad("description é obrigatório");
  for (const key of ["host", "ssh", "cwd"] as const) {
    if (raw[key] !== undefined && !isText(raw[key])) bad(`${key} é um texto`);
  }

  const run = raw.run;
  const argv = Array.isArray(run) && run.length > 0 && run.every(isText) ? (run as string[]) : null;
  if (!argv)
    bad("run é uma lista de textos (o programa e os argumentos), nunca uma linha de shell");

  const env = isRecord(raw.env) ? raw.env : {};
  if (raw.env !== undefined && !isRecord(raw.env)) bad("env é um mapa de NOME para valor");
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME.test(key) || !isText(value))
      bad(`env ${key} precisa de um nome de variável e um texto`);
  }

  const params: Record<string, ActionParam> = {};
  const rawParams = isRecord(raw.params) ? raw.params : {};
  if (raw.params !== undefined && !isRecord(raw.params)) bad("params é um mapa de nome para regra");
  for (const [key, spec] of Object.entries(rawParams)) {
    const pattern = isRecord(spec) ? spec.pattern : undefined;
    if (!isText(pattern) || pattern === "") {
      bad(`o parâmetro ${key} precisa de um pattern`);
      continue;
    }
    let regex: RegExp | null = null;
    try {
      regex = paramRegex(pattern);
    } catch {
      bad(`o pattern do parâmetro ${key} não é uma regex válida`);
      continue;
    }
    const given = (spec as Record<string, unknown>).default;
    if (given !== undefined && (!isText(given) || !regex.test(given))) {
      bad(`o default do parâmetro ${key} não casa com o pattern`);
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
      bad(`timeoutS é um inteiro de 1 a ${MAX_TIMEOUT_S}`);
    }
  }
  if (
    raw.approval !== undefined &&
    raw.approval !== "always" &&
    raw.approval !== "never" &&
    raw.approval !== "first-per-session"
  ) {
    bad("approval é always, never ou first-per-session");
  }

  let tags: string[] | undefined;
  if (raw.tags !== undefined) {
    const given = raw.tags;
    if (
      !Array.isArray(given) ||
      given.length > MAX_TAGS ||
      !given.every((tag) => isText(tag) && TAG.test(tag))
    ) {
      bad(`tags é uma lista de até ${MAX_TAGS} rótulos curtos, sem espaço (como prod)`);
    } else {
      tags = [...new Set((given as string[]).map((tag) => tag.toLowerCase()))];
    }
  }

  if (argv) {
    for (const [i, arg] of argv.entries()) {
      if (referencesIn(arg).some((r) => r.kind === "secret")) {
        bad(
          `o segredo não pode ir em argumento (aparece na lista de processos): "${arg}"; use env ou secretFile`,
        );
      }
      if (i === 0 && referencesIn(arg).some((r) => r.kind === "param")) {
        bad("o executável (run[0]) não pode ser um parâmetro");
      }
    }
    argv.forEach((arg, i) => {
      const flag = CODE_FLAGS[arg.trim().toLowerCase()];
      if (!flag) return;
      const codeArgs = flag.all ? argv.slice(i + 1) : argv.slice(i + 1, i + 2);
      if (codeArgs.some((code) => referencesIn(code).some((r) => r.kind === "param"))) {
        bad(`{{param}} não pode ocupar a posição de código de um interpretador (depois de ${arg})`);
      }
    });
  }
  if (isText(raw.cwd) && referencesIn(raw.cwd).some((r) => r.kind !== "param")) {
    bad("cwd não pode levar segredo");
  }

  const texts = [
    ...(argv ?? []),
    ...(isText(raw.cwd) ? [raw.cwd] : []),
    ...Object.values(env).filter(isText),
  ];
  for (const ref of texts.flatMap(referencesIn)) {
    if (ref.kind === "param" && !(ref.name in params)) {
      bad(`o parâmetro ${ref.name} é usado e não foi declarado`);
    }
    if (ref.kind !== "param" && opts.secretIds && !opts.secretIds.has(ref.name)) {
      bad(`o segredo ${ref.name} não existe no cofre`);
    }
  }

  if (
    isText(raw.ssh) &&
    texts.some((text) => referencesIn(text).some((r) => r.kind === "secretFile"))
  ) {
    bad(
      "numa ação ssh o secretFile não existe: seria um caminho local num comando remoto; use env",
    );
  }

  if (errors.length > 0 || !argv) return { action: null, errors };
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
  return { action, errors };
}

/** An `actions.yaml`: the valid actions, and the errors of the others. */
export function parseActions(
  yaml: string,
  opts: ParseOptions = {},
): { actions: ActionDef[]; errors: string[] } {
  let document: unknown;
  try {
    document = Bun.YAML.parse(yaml);
  } catch (error) {
    return { actions: [], errors: [`YAML inválido: ${(error as Error).message}`] };
  }
  if (document === null || document === undefined) return { actions: [], errors: [] };
  if (!Array.isArray(document)) {
    return { actions: [], errors: ["o arquivo de ações é uma lista de ações"] };
  }
  const actions: ActionDef[] = [];
  const errors: string[] = [];
  const names = new Set<string>();
  for (const raw of document) {
    const result = validateAction(raw, opts);
    errors.push(...result.errors);
    if (!result.action) continue;
    if (names.has(result.action.name)) {
      errors.push(`ação ${result.action.name}: nome repetido`);
      continue;
    }
    names.add(result.action.name);
    actions.push(result.action);
  }
  return { actions, errors };
}
