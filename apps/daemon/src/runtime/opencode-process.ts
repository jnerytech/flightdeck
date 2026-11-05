/**
 * Phase 39: running a short OpenCode command (`--version`, `models`, `api ... --standalone`): its
 * output, its exit code, and a deadline after which its whole process group is killed (an
 * `api --standalone` starts a private server).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { FlightdeckError } from "../errors.ts";
import { OPENCODE_API_TIMEOUT_MS, opencodeConfig, opencodeEnv } from "./opencode-config.ts";
import type { RunResult } from "./opencode-discovery.ts";
import type { ScopeResult } from "./opencode-scope.ts";

/** The exit code a run reports when it hit its deadline. */
export const TIMED_OUT = 124;

/**
 * The process and what it started: its group on POSIX, its tree on Windows. A process not yet
 * reaped (even a zombie) still holds its group, so the kill cannot miss it; a reaped one is skipped.
 */
function killTree(child: Subprocess): void {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"]);
  else process.kill(-child.pid, "SIGKILL");
}

export async function runCommand(
  argv: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<RunResult> {
  const child = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    // Its own process group on POSIX, so the deadline reaches what it started.
    detached: process.platform !== "win32",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, opts.timeoutMs);
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  clearTimeout(timer);
  return timedOut ? { exitCode: TIMED_OUT, stdout: "" } : { exitCode, stdout };
}

export interface ModelListOptions {
  path: string;
  /** The OpenCode child's environment, before the OpenCode variables. */
  env: Record<string, string>;
  /** A folder of Flightdeck's own, empty, to run in. */
  dataDir: string;
  run: (
    argv: string[],
    opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
  ) => Promise<RunResult>;
  scan: () => Promise<ScopeResult>;
  now?: () => number;
}

export const MODELS_CACHE_MS = 5 * 60_000;

function unavailable(why: string): FlightdeckError {
  return new FlightdeckError(
    "invalid_state",
    `OpenCode cannot list its models: ${why}`,
    "runtime_unavailable",
  );
}

/** OpenCode's `models --standalone`, one `provider/model` per line, cached for 5 minutes. */
export class OpenCodeModels {
  private cached: { at: number; models: Array<{ id: string; name: string }> } | null = null;

  constructor(private readonly opts: ModelListOptions) {}

  async list(): Promise<Array<{ id: string; name: string }>> {
    // The global scope again first: `models` would load its plugins too.
    if ((await this.opts.scan()).findings.length > 0)
      throw unavailable("its global config is not safe");
    const now = (this.opts.now ?? Date.now)();
    if (this.cached && now - this.cached.at < MODELS_CACHE_MS) return this.cached.models;
    const folder = join(this.opts.dataDir, "opencode-models");
    await mkdir(folder, { recursive: true });
    const result = await this.opts.run([this.opts.path, "models", "--standalone"], {
      cwd: folder,
      env: opencodeEnv(this.opts.env, JSON.stringify(opencodeConfig())),
      timeoutMs: OPENCODE_API_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) throw unavailable(`exit ${result.exitCode}`);
    const models = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/"))
      .map((id) => ({ id, name: id }));
    this.cached = { at: now, models };
    return models;
  }
}
