/**
 * Phase 17: running a declared action. The program gets its argv as a list (never a shell line),
 * the secret only in its environment or in a temporary file that is deleted afterwards (never as
 * an argument, which shows up in the process list), and what comes back is masked and cut. Every
 * parameter has to match the whole of its pattern.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildChildEnv } from "../env.ts";
import { FlightdeckError } from "../errors.ts";
import { type MaskedSecret, maskOutput } from "./mask.ts";
import { type ActionDef, paramRegex, REFERENCE, secretsOf } from "./schema.ts";

export interface SshJob {
  target: string;
  argv: string[];
  env: Record<string, string>;
  timeoutS: number;
  /** The destino's key from the vault, when it authenticates with one; for this run only. */
  privateKey?: string;
}

/** The SSH destinations of phase 15 plug in here: `ssh <target> -- <argv>` with the env sent. */
export type SshExecutor = (
  job: SshJob,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface RunOptions {
  /** The folder relative paths are resolved against (the project's). */
  base: string;
  /** The daemon's environment; what reaches the program is cleaned. */
  baseEnv?: Record<string, string | undefined>;
  /** Milliseconds; the action's `timeoutS` when absent (tests make it short). */
  timeoutMs?: number;
  ssh?: SshExecutor;
}

export interface RunResult {
  exitCode: number;
  /** stdout, then stderr, masked and at most 32 KB. */
  output: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/** What comes back to Claude is at most this long. */
export const MAX_OUTPUT = 32 * 1024;
const MAX_STDOUT = 24 * 1024;
const MAX_STDERR = MAX_OUTPUT - MAX_STDOUT;
/** What is read from the program before masking; the rest is drained and dropped. */
const MAX_CAPTURE = 250_000;

const bad = (message: string) => new FlightdeckError("bad_request", message);
const invalid = (message: string) => new FlightdeckError("invalid_state", message);

/** The values of every parameter: those given, else the default; each matching its whole pattern. */
export function resolveParams(
  action: ActionDef,
  given: Record<string, string>,
): Record<string, string> {
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(action.params, key)) throw bad(`parâmetro desconhecido: ${key}`);
  }
  const values: Record<string, string> = {};
  for (const [key, spec] of Object.entries(action.params)) {
    const value = given[key] ?? spec.default;
    if (value === undefined) throw bad(`falta o parâmetro ${key}`);
    if (!paramRegex(spec.pattern).test(value)) {
      throw bad(`o parâmetro ${key} não casa com o padrão ${spec.pattern}`);
    }
    values[key] = value;
  }
  return values;
}

/** Reads a stream to the end, keeping the first `MAX_CAPTURE` characters. */
async function capture(
  stream: ReadableStream<Uint8Array>,
): Promise<{ text: string; capped: boolean }> {
  const decoder = new TextDecoder();
  let text = "";
  let capped = false;
  for await (const chunk of stream) {
    if (text.length >= MAX_CAPTURE) {
      capped = true;
      continue;
    }
    text += decoder.decode(chunk, { stream: true });
    if (text.length > MAX_CAPTURE) {
      text = text.slice(0, MAX_CAPTURE);
      capped = true;
    }
  }
  return { text, capped };
}

/** One stream, masked and then cut to `limit`. */
function finishStream(
  raw: string,
  capped: boolean,
  secrets: MaskedSecret[],
  limit: number,
): { text: string; truncated: boolean } {
  // Masked whole before any cut, so a secret never leaves half of itself at the end.
  const masked = maskOutput(raw, secrets);
  return masked.length > limit
    ? { text: `${masked.slice(0, limit)}\n[saída cortada]`, truncated: true }
    : { text: masked, truncated: capped };
}

/** stdout then stderr, each masked and with its share of the 32 KB. */
function finish(
  streams: { out: string; err: string; outCapped: boolean; errCapped: boolean },
  secrets: MaskedSecret[],
) {
  const out = finishStream(streams.out, streams.outCapped, secrets, MAX_STDOUT);
  const err = finishStream(streams.err, streams.errCapped, secrets, MAX_STDERR);
  return {
    truncated: out.truncated || err.truncated,
    output: err.text ? `${out.text}\n[stderr]\n${err.text}` : out.text,
  };
}

/**
 * Runs the action with its (already resolved) parameters and the secrets the app delivered, by
 * id. Throws before starting anything when a secret is missing or the program cannot start.
 */
export async function runAction(
  action: ActionDef,
  params: Record<string, string>,
  secrets: Record<string, string>,
  opts: RunOptions,
): Promise<RunResult> {
  const { values, files } = secretsOf(action);
  for (const id of [...values, ...files]) {
    if (!Object.hasOwn(secrets, id)) throw invalid(`o segredo ${id} não foi entregue`);
  }
  if (action.ssh && !opts.ssh) {
    throw invalid(`a ação ${action.name} roda por ssh: os destinos SSH chegam com a Fase 15`);
  }
  const masked: MaskedSecret[] = [...values, ...files].map((id) => ({
    name: id,
    value: secrets[id] as string,
  }));
  const folder = mkdtempSync(join(tmpdir(), "fd-action-"));
  const started = performance.now();
  try {
    const paths: Record<string, string> = {};
    for (const [i, id] of files.entries()) {
      paths[id] = join(folder, `segredo-${i}`);
      writeFileSync(paths[id] as string, secrets[id] as string, { mode: 0o600 });
    }
    const fill = (text: string) =>
      text.replace(new RegExp(REFERENCE.source, "g"), (_match, kind: string, name: string) => {
        if (kind === "param") return params[name] as string;
        return kind === "secret" ? (secrets[name] as string) : (paths[name] as string);
      });
    const argv = action.run.map(fill);
    const env = Object.fromEntries(Object.entries(action.env).map(([k, v]) => [k, fill(v)]));
    const timeoutMs = opts.timeoutMs ?? action.timeoutS * 1000;

    if (action.ssh) {
      const done = await (opts.ssh as SshExecutor)({
        target: action.ssh,
        argv,
        env,
        timeoutS: action.timeoutS,
      });
      return {
        exitCode: done.exitCode,
        durationMs: Math.round(performance.now() - started),
        timedOut: false,
        ...finish(
          { out: done.stdout, err: done.stderr, outCapped: false, errCapped: false },
          masked,
        ),
      };
    }

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(argv, {
        cwd: action.cwd ? resolve(opts.base, fill(action.cwd)) : opts.base,
        env: { ...buildChildEnv(opts.baseEnv ?? process.env, false), ...env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      // The reason of a spawn failure may quote the environment; only the program is named.
      throw invalid(`não consegui executar ${action.run[0]}`);
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    const [out, err, code] = await Promise.all([
      capture(proc.stdout as ReadableStream<Uint8Array>),
      capture(proc.stderr as ReadableStream<Uint8Array>),
      proc.exited,
    ]);
    clearTimeout(timer);
    return {
      exitCode: code,
      durationMs: Math.round(performance.now() - started),
      timedOut,
      ...finish(
        { out: out.text, err: err.text, outCapped: out.capped, errCapped: err.capped },
        masked,
      ),
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
