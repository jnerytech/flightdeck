/**
 * Phase 39: whether this host can run OpenCode sessions. The executable (config, PATH, then
 * `<HOME>/.opencode/bin`), its version (v2 only), the global and system scopes (ADR 39-1), and a
 * canary that proves project config is off on this version: a harmless `opencode.json` in a folder
 * of Flightdeck's own must not be listed as a config source.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OPENCODE_API_TIMEOUT_MS,
  opencodeConfig,
  opencodeEnv,
  VERIFIED_OPENCODE_VERSION,
} from "./opencode-config.ts";
import { unexpectedSource } from "./opencode-preflight.ts";
import { globalConfigDir, type ScopeFinding, type ScopeResult } from "./opencode-scope.ts";

export type OpenCodeUnavailable =
  | "opencode_disabled"
  | "opencode_missing"
  | "opencode_version_failed"
  | "opencode_v1"
  | "opencode_unsafe_global"
  | "opencode_project_config_not_disabled"
  | "opencode_canary_failed"
  | "opencode_scope_mismatch";

export interface OpenCodeInfo {
  available: boolean;
  path?: string;
  version?: string;
  /** False when the version is newer than the one this phase verified. */
  verified?: boolean;
  reason?: OpenCodeUnavailable;
  /** What the global or system scope would load (with `opencode_unsafe_global`). */
  findings?: ScopeFinding[];
  /** The executable's size and time, for the preflight to notice a replaced binary. */
  fingerprint?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
}

export interface DiscoveryDeps {
  /** The OpenCode child's environment (HOME, PATH, ...), before the OpenCode variables. */
  env: Record<string, string>;
  platform: NodeJS.Platform;
  /** A folder of Flightdeck's own for the canary. */
  dataDir: string;
  which: (bin: string) => string | null;
  exists: (path: string) => Promise<boolean>;
  run: (
    argv: string[],
    opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
  ) => Promise<RunResult>;
  scan: () => Promise<ScopeResult>;
  /** `size:mtime` of a file; null when it is not there. */
  statFile?: (path: string) => Promise<string | null>;
}

export const CANARY_MODEL = "flightdeck-canary/none";

/** `size:mtime` of a file, so a replaced OpenCode binary is noticed; null when it is not there. */
export async function fileStamp(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  return info ? `${info.size}:${info.mtimeMs}` : null;
}

/** Whether a file is there, without blocking. */
export async function fileExists(path: string): Promise<boolean> {
  return (await fileStamp(path)) !== null;
}

/** `opencode v2.2.5` gives `2.2.5`. */
export function parseOpenCodeVersion(stdout: string): string | null {
  return /opencode v(\d+\.\d+\.\d+\S*)/.exec(stdout)?.[1] ?? null;
}

export async function resolveOpenCodePath(
  configured: string | undefined,
  deps: Pick<DiscoveryDeps, "env" | "platform" | "which" | "exists">,
): Promise<string | null> {
  if (configured) return configured;
  const onPath = deps.which("opencode");
  if (onPath) return onPath;
  const home = deps.env.HOME || deps.env.USERPROFILE;
  if (!home) return null;
  const local = join(
    home,
    ".opencode",
    "bin",
    deps.platform === "win32" ? "opencode.exe" : "opencode",
  );
  return (await deps.exists(local)) ? local : null;
}

/** Whether `a` is a later version than `b` (numeric parts only). */
function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/**
 * Runs the canary: `ok` when the canary's own `opencode.json` is not a config source and the global
 * folder OpenCode reports is the one the scope scan read; `null` when it could not run.
 */
async function canary(
  path: string,
  deps: DiscoveryDeps,
): Promise<"ok" | "listed" | "mismatch" | null> {
  const folder = join(deps.dataDir, "opencode-canary");
  const file = join(folder, "opencode.json");
  await mkdir(folder, { recursive: true });
  await writeFile(file, JSON.stringify({ model: CANARY_MODEL }));
  const result = await deps.run([path, "api", "GET", "/api/config", "--standalone"], {
    cwd: folder,
    env: opencodeEnv(deps.env, JSON.stringify(opencodeConfig())),
    timeoutMs: OPENCODE_API_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return null;
  try {
    const sources = JSON.parse(result.stdout) as Array<{ type?: string; path?: string }>;
    if (!Array.isArray(sources)) return null;
    if (sources.some((source) => source.path === file)) return "listed";
    // The preflight's own rule: any other source (another spelling of the canary, another folder).
    return unexpectedSource(sources, globalConfigDir(deps.env)) ? "mismatch" : "ok";
  } catch {
    return null;
  }
}

export async function discoverOpenCode(
  config: { enabled: boolean; executablePath?: string },
  deps: DiscoveryDeps,
): Promise<OpenCodeInfo> {
  if (!config.enabled) return { available: false, reason: "opencode_disabled" };
  const path = await resolveOpenCodePath(config.executablePath, deps);
  if (!path) return { available: false, reason: "opencode_missing" };
  const probe = await deps.run([path, "--version"], {
    cwd: deps.dataDir,
    env: opencodeEnv(deps.env, JSON.stringify(opencodeConfig())),
    // A cold start on the Pi takes about 2 s.
    timeoutMs: 5_000,
  });
  const version = probe.exitCode === 0 ? parseOpenCodeVersion(probe.stdout) : null;
  if (!version) return { available: false, path, reason: "opencode_version_failed" };
  if (!version.startsWith("2.") && !newer(version, "2.0.0")) {
    return { available: false, path, version, reason: "opencode_v1" };
  }
  const scope = await deps.scan();
  if (scope.findings.length > 0) {
    return {
      available: false,
      path,
      version,
      reason: "opencode_unsafe_global",
      findings: scope.findings,
    };
  }
  const proof = await canary(path, deps);
  if (proof === null) return { available: false, path, version, reason: "opencode_canary_failed" };
  if (proof === "listed") {
    return { available: false, path, version, reason: "opencode_project_config_not_disabled" };
  }
  if (proof === "mismatch")
    return { available: false, path, version, reason: "opencode_scope_mismatch" };
  const fingerprint = (await deps.statFile?.(path)) ?? null;
  return {
    available: true,
    path,
    version,
    // Only the version this phase checked; an older 2.x was never verified either.
    verified: version === VERIFIED_OPENCODE_VERSION,
    ...(fingerprint ? { fingerprint } : {}),
  };
}
