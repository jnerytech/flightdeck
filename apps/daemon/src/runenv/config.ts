import type { Database } from "bun:sqlite";
import type { Project } from "@flightdeck/protocol";
import { type core, z } from "zod";
import { git } from "../board/command.ts";
import { must } from "../board/worktree.ts";
import { FlightdeckError } from "../errors.ts";
import { hashOf } from "../workflows/repo.ts";

/** Where a project's run environment is declared, read from the base branch only. */
export const RUN_CONFIG_PATH = ".flightdeck/run.yaml";

/** A block holds this many ports per card. */
export const PORT_BLOCK = 10;

export interface RunProcess {
  name: string;
  cmd: string[];
  env: Record<string, string>;
  /** The preview URL: the process is ready when it answers. */
  ready: { http: string } | null;
}

export interface RunConfig {
  /** One card runs at a time in this project (the "não concorrente" mode). */
  exclusive: boolean;
  /** The preparation, run once per card; `null` when there is none. */
  setup: string[] | null;
  run: RunProcess[];
  /** Names of the ports of a card's block, in the block's order. */
  ports: string[];
}

export interface ParsedRunConfig {
  config: RunConfig | null;
  errors: string[];
}

export interface RunConfigInfo {
  exists: boolean;
  hash: string | null;
  trusted: boolean;
  errors: string[];
  config: RunConfig | null;
}

const text = z.string().min(1, "não pode ser vazio");
const argv = z
  .array(text, { error: "precisa ser uma lista de textos" })
  .min(1, "precisa de ao menos um item");

const ProcessSchema = z.strictObject({
  name: z.string().regex(/^[\w-]+$/, "nome inválido"),
  cmd: argv,
  env: z.record(z.string(), z.string()).default({}),
  ready: z.strictObject({ http: text }).optional(),
});
const RunConfigSchema = z.strictObject({
  exclusive: z.boolean().default(false),
  setup: argv.optional(),
  run: z.array(ProcessSchema).min(1, "precisa de ao menos um item"),
  ports: z
    .array(z.string().regex(/^[\w-]+$/, "nome de porta inválido"))
    .max(PORT_BLOCK, `no máximo ${PORT_BLOCK} portas por card`)
    .default([]),
});

/** Messages for what the schemas above leave to zod's defaults. */
function message(issue: core.$ZodRawIssue): string {
  if (issue.code === "unrecognized_keys") return `campo desconhecido: ${issue.keys.join(", ")}`;
  if (issue.input === undefined) return "obrigatório";
  return issue.code === "invalid_type" && issue.expected === "object"
    ? "precisa ser um objeto"
    : "tipo inválido";
}

const where = (path: readonly PropertyKey[]) =>
  path.length === 0 ? "(raiz)" : path.map(String).join(".");

/** `{{ expression }}` inside commands, variables and the ready URL. */
const REFERENCE = /\{\{\s*(.*?)\s*\}\}/g;

/** The variable that carries a port: `FLIGHTDECK_PORT_<NAME>`. */
export const portVariable = (name: string) =>
  `FLIGHTDECK_PORT_${name.toUpperCase().replaceAll("-", "_")}`;

/** What the schema cannot see: repeated names, `{{port.…}}` references and the ready URL. */
function validate(config: RunConfig): string[] {
  const errors: string[] = [];
  const seenPorts = new Set<string>();
  config.ports.forEach((name, i) => {
    const variable = portVariable(name);
    if (seenPorts.has(variable)) errors.push(`ports.${i}: porta repetida: ${name}`);
    seenPorts.add(variable);
  });
  const declared = new Set(config.ports);
  const references = (path: string, value: string) => {
    for (const [raw, expression] of value.matchAll(REFERENCE)) {
      const port = /^port\.([\w-]+)$/.exec(expression ?? "")?.[1];
      if (port === undefined) errors.push(`${path}: referência desconhecida: ${raw}`);
      else if (!declared.has(port)) errors.push(`${path}: porta não declarada: ${port}`);
    }
  };
  const names = new Set<string>();
  config.run.forEach((proc, i) => {
    if (names.has(proc.name)) errors.push(`run.${i}: nome repetido: ${proc.name}`);
    names.add(proc.name);
    for (const [j, part] of proc.cmd.entries()) references(`run.${i}.cmd.${j}`, part);
    for (const [key, value] of Object.entries(proc.env)) references(`run.${i}.env.${key}`, value);
    if (!proc.ready) return;
    const url = proc.ready.http;
    references(`run.${i}.ready.http`, url);
    const problem = urlProblem(url);
    if (problem) errors.push(`run.${i}.ready.http: ${problem}`);
  });
  for (const [j, part] of (config.setup ?? []).entries()) references(`setup.${j}`, part);
  return errors;
}

/** Why a ready URL is refused: the preview only opens http(s) on this machine. */
function urlProblem(url: string): string | null {
  let parsed: URL;
  try {
    // A port placeholder stands for a number here: the real one only exists per card.
    parsed = new URL(url.replace(REFERENCE, "1"));
  } catch {
    return "URL inválida";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return "precisa ser http ou https";
  if (parsed.username || parsed.password) return "sem usuário nem senha no endereço";
  return LOOPBACK.has(parsed.hostname) ? null : "só 127.0.0.1 e localhost";
}

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** Loads a run.yaml and validates it; `config` is `null` whenever there is an error. */
export function parseRunConfig(source: string): ParsedRunConfig {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(source);
  } catch (error) {
    return { config: null, errors: [`YAML inválido: ${(error as Error).message}`] };
  }
  const parsed = RunConfigSchema.safeParse(raw, { error: message });
  if (!parsed.success) {
    return {
      config: null,
      errors: parsed.error.issues.map((i) => `${where(i.path)}: ${i.message}`),
    };
  }
  const config: RunConfig = {
    exclusive: parsed.data.exclusive,
    setup: parsed.data.setup ?? null,
    run: parsed.data.run.map((p) => ({
      name: p.name,
      cmd: p.cmd,
      env: p.env,
      ready: p.ready ? { http: p.ready.http } : null,
    })),
    ports: parsed.data.ports,
  };
  const errors = validate(config);
  return errors.length > 0 ? { config: null, errors } : { config, errors };
}

/** Every command the file declares: the setup and each process, as written (before the ports). */
export function declaredCommands(config: RunConfig): string[][] {
  return [...(config.setup ? [config.setup] : []), ...config.run.map((p) => p.cmd)];
}

export function isDeclared(config: RunConfig, argv: string[]): boolean {
  return declaredCommands(config).some(
    (declared) => declared.length === argv.length && declared.every((part, i) => part === argv[i]),
  );
}

type ProjectRef = Pick<Project, "id" | "path" | "baseBranch">;

interface RunSource {
  source: string;
  hash: string;
}

/** The run.yaml as committed on `base`, never the card's worktree (the agent could write it). */
async function runConfigSource(repo: string, base: string): Promise<RunSource | null> {
  const listed = must(
    await git(repo, "ls-tree", "-z", "--name-only", base, "--", RUN_CONFIG_PATH),
    "git ls-tree",
  );
  if (!listed.stdout.split("\0").includes(RUN_CONFIG_PATH)) return null;
  const { stdout: source } = must(
    await git(repo, "show", `${base}:${RUN_CONFIG_PATH}`),
    "git show",
  );
  return { source, hash: hashOf(source) };
}

/** The run configuration of the projects: read from the base branch, with trust by hash. */
export class RunConfigs {
  constructor(readonly opts: { db: Database }) {}

  async info(project: ProjectRef): Promise<RunConfigInfo> {
    const found = await runConfigSource(project.path, project.baseBranch);
    if (!found) return { exists: false, hash: null, trusted: false, errors: [], config: null };
    const { config, errors } = parseRunConfig(found.source);
    return {
      exists: true,
      hash: found.hash,
      trusted: this.trusted(project.id, found.hash),
      errors,
      config,
    };
  }

  /** Trusts the file's current content; `hash` is what the user reviewed. */
  async trust(project: ProjectRef, hash: string): Promise<RunConfigInfo> {
    const found = await runConfigSource(project.path, project.baseBranch);
    if (!found) throw new FlightdeckError("invalid_state", `sem ${RUN_CONFIG_PATH} no ramo-base`);
    if (found.hash !== hash) {
      throw new FlightdeckError(
        "invalid_state",
        "o run.yaml mudou; revise os comandos de novo antes de confiar",
      );
    }
    if (parseRunConfig(found.source).errors.length > 0) {
      throw new FlightdeckError("invalid_state", "o run.yaml tem erros de validação");
    }
    this.opts.db
      .query(
        "INSERT OR IGNORE INTO trusted_run_configs (project_id, hash, trusted_at) VALUES (?, ?, ?)",
      )
      .run(project.id, hash, new Date().toISOString());
    return this.info(project);
  }

  /** The trusted, valid configuration, or an error saying what is missing. */
  async resolve(project: ProjectRef): Promise<RunConfig> {
    const info = await this.info(project);
    if (!info.exists)
      throw new FlightdeckError("invalid_state", `sem ${RUN_CONFIG_PATH} no ramo-base`);
    if (!info.config) {
      throw new FlightdeckError(
        "invalid_state",
        `o run.yaml tem erros de validação: ${info.errors.join("; ")}`,
      );
    }
    if (!info.trusted) {
      throw new FlightdeckError("invalid_state", "run.yaml não confiado; confie nele no card");
    }
    return info.config;
  }

  private trusted(projectId: string, hash: string): boolean {
    return (
      this.opts.db
        .query("SELECT 1 FROM trusted_run_configs WHERE project_id = ? AND hash = ?")
        .get(projectId, hash) !== null
    );
  }
}
