import { z } from "zod";

// Phase 24: the run environment's shared checks, so the daemon (which waits for a process to
// answer) and the app (which shows it) agree on which addresses a preview may open.

const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "localhost"]);

/** The preview opens http(s) on this machine (127.0.0.1 or localhost), without credentials, and nowhere else. */
export function isPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      LOOPBACK.has(parsed.hostname) &&
      // Credentials in an address are never needed for a local dev server.
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

const PortNames = z.array(z.string());

/** One process of a run.yaml, as written (before the ports are filled in). */
export const RunProcessConfig = z.object({
  name: z.string(),
  cmd: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  ready: z.object({ http: z.string() }).nullable(),
});
export type RunProcessConfig = z.infer<typeof RunProcessConfig>;

export const RunConfigData = z.object({
  exclusive: z.boolean(),
  setup: z.array(z.string()).nullable(),
  run: z.array(RunProcessConfig),
  ports: PortNames,
});
export type RunConfigData = z.infer<typeof RunConfigData>;

/** A project's `.flightdeck/run.yaml` on its base branch, with the hash the user trusts. */
export const RunConfigInfo = z.object({
  exists: z.boolean(),
  hash: z.string().nullable(),
  trusted: z.boolean(),
  errors: z.array(z.string()),
  config: RunConfigData.nullable(),
});
export type RunConfigInfo = z.infer<typeof RunConfigInfo>;

/** One process of a card's run: a terminal tab with a state, and its preview address. */
export const RunProcessState = z.object({
  name: z.string(),
  terminalId: z.string(),
  status: z.enum(["running", "exited"]),
  exitCode: z.number().int().nullable(),
  url: z.string().nullable(),
  ready: z.enum(["none", "waiting", "ready", "timeout"]),
});
export type RunProcessState = z.infer<typeof RunProcessState>;

/** A card's run environment: the setup, the ports of its block and the processes. */
export const RunState = z.object({
  cardId: z.string(),
  status: z.enum(["idle", "setup", "running", "ended", "failed"]),
  setup: z.enum(["pending", "running", "done", "failed"]),
  setupTerminalId: z.string().nullable(),
  ports: z.record(z.string(), z.number().int()),
  processes: z.array(RunProcessState),
  error: z.string().nullable(),
});
export type RunState = z.infer<typeof RunState>;
