import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PermissionMode } from "@flightdeck/protocol";
import { z } from "zod";
import { PricingConfig } from "./costs/pricing.ts";
import { DEFAULT_ALLOWED_NETWORKS, parseCidr } from "./networks.ts";

/** A compiled flightdeckd (bun build --compile) runs from its embedded file system. */
export const RUNNING_COMPILED = Bun.main.includes("$bunfs") || Bun.main.includes("~BUN");

/** Where each release publishes the daemons' manifest. */
export const MANIFEST_URL =
  "https://github.com/jnerytech/flightdeck/releases/latest/download/daemon-latest.json";

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
  board: z
    .object({
      /** How often cards with an open PR are checked; 60 s when absent. */
      prPollIntervalMs: z.number().int().min(10).optional(),
    })
    .default(() => ({})),
  /** Claude Code hooks (phase 5): receptor on 127.0.0.1 and the token written by install. */
  hooks: z
    .object({
      port: z.number().int().min(0).max(65535).default(7421),
      token: z.string().min(16).optional(),
      permissionTimeoutS: z.number().int().min(1).default(600),
      staleAfterS: z.number().int().min(1).default(900),
    })
    .default(() => ({ port: 7421, permissionTimeoutS: 600, staleAfterS: 900 })),
  /** Retention (phase 7): data of sessions ended this many days ago is pruned; 0 = on end. */
  retention: z
    .object({
      eventsDays: z.number().int().min(0).default(90),
      externalSessionsDays: z.number().int().min(0).default(30),
      /** Usage entries for costs (phase 8). */
      usageDays: z.number().int().min(1).default(400),
    })
    .default(() => ({ eventsDays: 90, externalSessionsDays: 30, usageDays: 400 })),
  /** Daily `VACUUM INTO <dataDir>/backups`, keeping the newest `keep`. */
  backup: z
    .object({
      enabled: z.boolean().default(true),
      keep: z.number().int().min(1).default(7),
    })
    .default(() => ({ enabled: true, keep: 7 })),
  /**
   * Phase 9: the release manifest the daemon checks. Only a compiled flightdeckd checks GitHub by
   * default: from the source tree there is no binary to update (and the tests stay offline).
   */
  updates: z
    .object({
      manifestUrl: z
        .string()
        .url()
        .nullable()
        .default(RUNNING_COMPILED ? MANIFEST_URL : null),
      checkIntervalH: z.number().int().min(1).default(24),
    })
    .default(() => ({ manifestUrl: RUNNING_COMPILED ? MANIFEST_URL : null, checkIntervalH: 24 })),
  /** Plan quota (phase 7): from `pauseAt` on, new cards wait for the window to reset. */
  quota: z
    .object({ pauseAt: z.number().min(0).max(1).nullable().default(0.9) })
    .default(() => ({ pauseAt: 0.9 })),
  /** API prices (phase 8): overrides of the default table, model by model. */
  pricing: PricingConfig.default(() => ({ models: {}, fastMultiplier: {} })),
  /** Stub. */
  risk: z.object({ extraHigh: z.array(z.string()).default([]) }).default(() => ({ extraHigh: [] })),
  /** Written by `service install`: services do not inherit the shell PATH. */
  claude: z.object({ executablePath: z.string().min(1).optional() }).optional(),
});
export type Config = z.infer<typeof Config>;

/**
 * The user's home, read from the environment on each call (`HOME`; `USERPROFILE` on Windows),
 * as Node's `os.homedir()` does. Bun's keeps, on Linux, the HOME the process started with.
 */
export function userHome(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): string {
  return (platform === "win32" ? env.USERPROFILE : env.HOME) || homedir();
}

export function defaultConfigPath(): string {
  return join(userHome(), ".flightdeck", "config.json");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function expandHome(path: string): string {
  if (path === "~") return userHome();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(userHome(), path.slice(2));
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
