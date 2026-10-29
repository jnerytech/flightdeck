import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PermissionMode } from "@flightdeck/protocol";
import { z } from "zod";
import { DEFAULT_ALLOWED_NETWORKS, parseCidr } from "./networks.ts";

export const DEFAULT_HISTORY_ROOTS = ["~/.claude/projects"] as const;

export const RuntimeKind = z.enum(["claude", "fake"]);
export type RuntimeKind = z.infer<typeof RuntimeKind>;

export const Config = z.object({
  hostName: z
    .string()
    .min(1)
    .default(() => hostname()),
  bind: z.string().min(1).default("127.0.0.1"),
  port: z.number().int().min(0).max(65535).default(7420),
  token: z
    .string()
    .min(16)
    .default(() => generateToken()),
  dataDir: z.string().min(1).default("~/.flightdeck/data"),
  allowedRoots: z.array(z.string()).default([]),
  /** CIDR ranges allowed to connect; anything else gets 403 before the WebSocket upgrade. */
  allowedNetworks: z
    .array(z.string().refine((cidr) => parseCidr(cidr) !== null, "CIDR inválido"))
    .default(() => [...DEFAULT_ALLOWED_NETWORKS]),
  runtime: RuntimeKind.default("claude"),
  defaultPermissionMode: PermissionMode.default("default"),
  allowApiKey: z.boolean().default(false),
  /** Cards running at the same time; the rest wait in start order (protects the quota). */
  maxParallelRuns: z.number().int().min(1).default(2),
  /** Legacy (phase 1) path to the `claude` executable; `claude.executablePath` wins. */
  claudePath: z.string().min(1).optional(),
  /** WSL distros whose daemon this (Windows) daemon supervises. */
  wsl: z
    .array(
      z.object({
        distro: z.string().min(1),
        command: z.string().min(1),
        port: z.number().int().min(1).max(65535),
      }),
    )
    .default([]),
  /** Claude Code transcripts indexed by the daemon (read only). */
  history: z
    .object({
      roots: z.array(z.string()).default(() => [...DEFAULT_HISTORY_ROOTS]),
      excludeCwds: z.array(z.string()).default([]),
      /** Full pass interval behind the file watcher; 10 s when absent. */
      scanIntervalMs: z.number().int().min(10).optional(),
    })
    .default(() => ({ roots: [...DEFAULT_HISTORY_ROOTS], excludeCwds: [] })),
  /** Written by `service install`: services do not inherit the shell PATH. */
  claude: z.object({ executablePath: z.string().min(1).optional() }).optional(),
});
export type Config = z.infer<typeof Config>;

export function defaultConfigPath(): string {
  return join(homedir(), ".flightdeck", "config.json");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Loads and validates the config file, creating it with defaults (and a fresh token) when it
 * does not exist. Paths are returned with `~` expanded.
 */
export function loadConfig(path: string = defaultConfigPath()): Config {
  const file = resolve(expandHome(path));
  let raw: unknown = {};
  if (existsSync(file)) {
    raw = JSON.parse(readFileSync(file, "utf8"));
  }
  const config = Config.parse(raw);
  const hasToken = typeof (raw as { token?: unknown }).token === "string";
  if (!existsSync(file) || !hasToken) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    // No-op on Windows (ACLs), restricts to the owner elsewhere.
    chmodSync(file, 0o600);
  }
  return {
    ...config,
    dataDir: resolve(expandHome(config.dataDir)),
    allowedRoots: config.allowedRoots.map((r) => resolve(expandHome(r))),
    history: {
      roots: config.history.roots.map((r) => resolve(expandHome(r))),
      // Compared with the transcripts' cwd as written, so only `~` is expanded.
      excludeCwds: config.history.excludeCwds.map(expandHome),
      ...(config.history.scanIntervalMs ? { scanIntervalMs: config.history.scanIntervalMs } : {}),
    },
  };
}

/**
 * Rewrites the raw config file through `update`, keeping fields it does not touch. Writes to a
 * temp file and renames it, so a running daemon never reads a half-written config.
 */
export function updateConfigFile(
  file: string,
  update: (raw: Record<string, unknown>) => Record<string, unknown>,
): void {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(update(raw), null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}
