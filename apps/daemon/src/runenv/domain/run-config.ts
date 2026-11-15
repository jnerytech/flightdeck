import { type core, z } from "zod";
import { referencesIn, replaceReferences } from "../../workflows/index.ts";
import { PORT_BLOCK, portVariable } from "./ports.ts";

interface RunProcess {
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

const text = z.string().min(1, "cannot be empty");
const argv = z
  .array(text, { error: "precisa ser uma lista de textos" })
  .min(1, "needs at least one item");

const ProcessSchema = z.strictObject({
  name: z.string().regex(/^[\w-]+$/, "invalid name"),
  cmd: argv,
  env: z.record(z.string(), z.string()).default({}),
  ready: z.strictObject({ http: text }).optional(),
});
const RunConfigSchema = z.strictObject({
  exclusive: z.boolean().default(false),
  setup: argv.optional(),
  run: z.array(ProcessSchema).min(1, "needs at least one item"),
  ports: z
    .array(z.string().regex(/^[\w-]+$/, "invalid port name"))
    .max(PORT_BLOCK, `at most ${PORT_BLOCK} ports per card`)
    .default([]),
});

/** Messages for what the schemas above leave to zod's defaults. */
function message(issue: core.$ZodRawIssue): string {
  if (issue.code === "unrecognized_keys") return `unknown field: ${issue.keys.join(", ")}`;
  if (issue.input === undefined) return "required";
  return issue.code === "invalid_type" && issue.expected === "object"
    ? "must be an object"
    : "invalid type";
}

const where = (path: readonly PropertyKey[]) =>
  path.length === 0 ? "(root)" : path.map(String).join(".");

/** What the schema cannot see: repeated names, `{{port.…}}` references and the ready URL. */
function validate(config: RunConfig): string[] {
  const errors: string[] = [];
  const seenPorts = new Set<string>();
  config.ports.forEach((name, i) => {
    const variable = portVariable(name);
    if (seenPorts.has(variable)) errors.push(`ports.${i}: repeated port: ${name}`);
    seenPorts.add(variable);
  });
  const declared = new Set(config.ports);
  const references = (path: string, value: string) => {
    for (const { raw, expression } of referencesIn(value)) {
      const port = /^port\.([\w-]+)$/.exec(expression)?.[1];
      if (port === undefined) errors.push(`${path}: unknown reference: ${raw}`);
      else if (!declared.has(port)) errors.push(`${path}: port not declared: ${port}`);
    }
  };
  const names = new Set<string>();
  config.run.forEach((proc, i) => {
    if (names.has(proc.name)) errors.push(`run.${i}: repeated name: ${proc.name}`);
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
    parsed = new URL(replaceReferences(url, () => "1"));
  } catch {
    return "invalid URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "must be http or https";
  if (parsed.username || parsed.password) return "no user or password in the address";
  return LOOPBACK.has(parsed.hostname) ? null : "only 127.0.0.1 and localhost";
}

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** Loads a run.yaml and validates it; `config` is `null` whenever there is an error. */
export function parseRunConfig(source: string): ParsedRunConfig {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(source);
  } catch (error) {
    return { config: null, errors: [`invalid YAML: ${(error as Error).message}`] };
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
