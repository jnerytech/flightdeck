// Host operations: the host's info and pause, its daemon updates, service, maintenance, logs, doctor, dependencies, releases, roots and folders (issue #1600: moved from index.ts).
import { z } from "zod";
import { cmd } from "./command.ts";
import { SessionRuntime } from "./sessions.ts";
import { TerminalSettings } from "./terminal.ts";

/** How the host presents itself to people: its default mode, and whether the switch is offered (phase 33). */
export const UiSettings = z.object({
  mode: z.enum(["full", "simple"]),
  locked: z.boolean(),
});
export type UiSettings = z.infer<typeof UiSettings>;

/** What `fs.files` answers: the files of a folder of the host (never outside the roots). */
export interface FsFilesResult {
  /** The folder listed (a real path). */
  path: string;
  files: Array<{ name: string; path: string }>;
  /** More files than the daemon returns at once. */
  truncated: boolean;
}

export const DOCTOR_CHECK_IDS = [
  "config",
  "folders",
  "service",
  "daemon",
  "claude",
  "hooks",
  "tailscale",
  "version",
  "templates",
  "mcp",
  "linger",
  /** Phase 39. */
  "opencode",
] as const;

/** One thing `doctor.run` checked; `fix` is what to run, absent when the check passed. */
export interface DoctorCheckResult {
  id: (typeof DOCTOR_CHECK_IDS)[number];
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
  /**
   * An optional tool that is not installed (OpenCode): its status is "ok", since nothing failed,
   * but the app shows it muted as "optional, not installed" rather than as OK (#670). An older
   * daemon leaves it out, and the app then shows the plain status.
   */
  absent?: true;
}

/** What `doctor.run` answers. */
export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheckResult[];
}

/** What the host needs to do its job (`required`) or to turn a feature on (`optional`). */
export const DEP_IDS = [
  "claude",
  "claudeAuth",
  "git",
  "service",
  "folders",
  "gh",
  "az",
  "ssh",
  "tailscale",
  "pwsh",
  "hooks",
] as const;

export type DepId = (typeof DEP_IDS)[number];

/** What stops working without a dependency: the names the app translates. */
export const DEP_FEATURES = [
  "sessions",
  "projects",
  "worktrees",
  "changes",
  "board",
  "autostart",
  "github",
  "pullRequests",
  "boardSync",
  "azure",
  "remoteHosts",
  "teleport",
  "pairing",
  "windowsSetup",
  "liveStatus",
] as const;

export type DepFeature = (typeof DEP_FEATURES)[number];

/** One dependency of a host, as `deps.check` found it. */
export interface DepResult {
  id: DepId;
  group: "required" | "optional";
  /** `na`: it does not apply to this operating system. */
  state: "ok" | "outdated" | "missing" | "na";
  version?: string;
  path?: string;
  /** The least version that works, when there is one. */
  minVersion?: string;
  breaks: DepFeature[];
  /**
   * How to install or upgrade it, per operating system: a package-manager command where one exists,
   * and the official install page. Never a download piped into a shell.
   */
  fix: Array<{
    os: "linux" | "darwin" | "win32";
    command?: string;
    url?: string;
    /** What to know before running it: the app words each code in both languages. */
    note?: "elevated" | "noSystemd";
  }>;
}

/** What `deps.check` answers. */
export interface DepsResult {
  items: DepResult[];
}

/** What `fs.dirs` answers: a folder of the host and its subfolders (never outside the roots). */
export interface FsDirsResult {
  /** The folder listed (a real path); null for the list of the allowed roots. */
  path: string | null;
  /** The folder above it, inside the roots; null at a root or at the list of roots. */
  parent: string | null;
  dirs: Array<{ name: string; path: string }>;
  /** More subfolders than the daemon returns at once. */
  truncated: boolean;
}

/** Phase 9: `daemon-latest.json`, published with each release. */
export const DaemonManifest = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  protocol: z.number().int(),
  assets: z.record(
    z.string(),
    z.object({
      url: z.string().url(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      signature: z.string(),
    }),
  ),
});
export type DaemonManifest = z.infer<typeof DaemonManifest>;

/** What the daemon found the last time it checked its manifest. */
export const UpdateStatus = z.object({
  available: z.boolean(),
  version: z.string().nullable(),
  checkedAt: z.string(),
  error: z.string().optional(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

/** Keep-awake (issue #163): the switch, whether the computer is held awake now, how, and why not. */
export const KeepAwakeStatus = z.object({
  enabled: z.boolean(),
  held: z.boolean(),
  method: z.enum(["powershell", "systemd-inhibit", "caffeinate"]).nullable(),
  reason: z
    .enum(["no-inhibitor", "unsupported-platform", "wsl", "start-failed", "ended"])
    .nullable(),
});
export type KeepAwakeStatus = z.infer<typeof KeepAwakeStatus>;

/** Issue #1404: whether new card runs wait on the host, and how many sessions still run there. */
export const HostPauseStatus = z.object({
  paused: z.boolean(),
  running: z.number().int().nonnegative(),
});
export type HostPauseStatus = z.infer<typeof HostPauseStatus>;

/** Issue #280: where the daemon's automatic update stands, for the host page. */
export const AutoUpdateStatus = z.object({
  enabled: z.boolean(),
  /** `off`, `current` (nothing newer), `waiting` (the host is busy), `started` or `failed`. */
  state: z.enum(["off", "current", "waiting", "started", "failed"]),
  version: z.string().optional(),
  reason: z.string().optional(),
  at: z.string().optional(),
});
export type AutoUpdateStatus = z.infer<typeof AutoUpdateStatus>;

/** Phase 39: a runtime the host offers besides Claude Code, as discovery found it. */
export const HostRuntime = z.object({
  kind: SessionRuntime,
  available: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  /** False when the version is not the one Flightdeck verified. */
  verified: z.boolean().optional(),
  /** Why it is not available (a reason the app translates). */
  reason: z.string().optional(),
});
export type HostRuntime = z.infer<typeof HostRuntime>;

export const HostInfoResult = z.object({
  hostName: z.string(),
  os: z.string(),
  arch: z.string(),
  daemonVersion: z.string(),
  claudeVersion: z.string().nullable(),
  claudePath: z.string().nullable(),
  uptimeSec: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  apiKeySanitized: z.boolean(),
  /**
   * Issue #1361: whether the app's own connection is near (loopback or Tailscale). Only a near one
   * may change what runs unattended (the checks, the check loop); absent from a host from before.
   */
  near: z.boolean().optional(),
  /** What the daemon offers (`central`, `workflows`, `maintenance`…); absent before phase 7. */
  features: z.array(z.string()).optional(),
  /** Phase 9: the last check of the daemon's release manifest; absent when it does not check. */
  update: UpdateStatus.optional(),
  /** Issue #280: the automatic update; absent on a host that does not offer it (the `autoUpdate` feature). */
  autoUpdate: AutoUpdateStatus.optional(),
  /** Phase 8: the stable `flightdeckd` (phase 7) when installed; "Abrir no terminal" runs it. */
  flightdeckdPath: z.string().nullable().optional(),
  /** Phase 8: the WSL distro this daemon runs in, `null` outside WSL. */
  wslDistro: z.string().nullable().optional(),
  /** Phase 14: the host's terminals: on or off, how many at most, which shell. */
  terminal: TerminalSettings.optional(),
  /** Phase 33: the host's default mode and lock; absent before the phase. */
  ui: UiSettings.optional(),
  /** Whether a session may start in `bypassPermissions`; absent on a daemon that predates the switch. */
  allowBypassPermissions: z.boolean().optional(),
  /** Issue #255: where the daemon writes its log; absent when it keeps none. */
  logPath: z.string().optional(),
  /** Issue #157: minutes idle before a session sleeps; 0 is off; absent on a daemon without it. */
  sleepAfterMinutes: z.number().int().nonnegative().optional(),
  /** The host's keep-awake switch and whether it is holding the computer now; absent before issue #163. */
  keepAwake: KeepAwakeStatus.optional(),
  /** Issue #1404: the host's pause of new card runs; absent on a daemon that predates it. */
  pause: HostPauseStatus.optional(),
  /** Phase 39: the host's other runtimes (OpenCode), each available or not with the reason. */
  runtimes: z.array(HostRuntime).optional(),
});
export type HostInfoResult = z.infer<typeof HostInfoResult>;

/** The host's allowed folders after `roots.add`. */
export const RootsResult = z.object({ allowedRoots: z.array(z.string()) });

export const BypassResult = z.object({ allowBypassPermissions: z.boolean() });
export type BypassResult = z.infer<typeof BypassResult>;

export type RootsResult = z.infer<typeof RootsResult>;

/**
 * #1200: what `service.install` did. The service is enabled for the next boot or login, never
 * started now: the daemon that answered keeps running.
 */
export interface ServiceInstallResult {
  /** When the service first runs: the next boot (Linux with linger on) or the next login. */
  startsAt: "boot" | "logon";
  /** Linux with linger off: until linger is on, the service starts only after a login. */
  lingerOff: boolean;
  /** The account a `sudo loginctl enable-linger <user>` line names. */
  user: string;
}

/** Phase 7: one backup file of the host's database. */
export const BackupInfo = z.object({ path: z.string(), at: z.string(), bytes: z.number() });
export type BackupInfo = z.infer<typeof BackupInfo>;

/** Rows removed (or that would be, with `dryRun`) per table. */
export const PruneCounts = z.record(z.string(), z.number());

/** Issue #125: one release of the app, with the bullets of the `## Highlights` section of its notes. */
export const ReleaseNote = z.object({
  tag: z.string(),
  title: z.string(),
  publishedAt: z.string(),
  url: z.string(),
  highlights: z.array(z.string()),
});
export type ReleaseNote = z.infer<typeof ReleaseNote>;

export const ReleaseList = z.object({ releases: z.array(ReleaseNote) });
export type ReleaseList = z.infer<typeof ReleaseList>;

export const LogTail = z.object({ lines: z.array(z.string()), path: z.string() });
export type LogTail = z.infer<typeof LogTail>;

export type PruneCounts = z.infer<typeof PruneCounts>;

export const MaintenanceStatus = z.object({
  /** Size of the database (pages × page size). */
  dbBytes: z.number(),
  lastBackup: BackupInfo.nullable(),
  /** Automatic backups, newest first. */
  backups: z.array(BackupInfo),
  lastPrune: z.object({ at: z.string(), dryRun: z.boolean(), counts: PruneCounts }).nullable(),
  counts: z.object({ sessions: z.number(), events: z.number(), externalSessions: z.number() }),
});
export type MaintenanceStatus = z.infer<typeof MaintenanceStatus>;

/** The host commands; index.ts spreads them into `Command`. */
export const hostCommands = [
  /** Issue #157: how many minutes idle before a session sleeps; 0 is off. */
  cmd("host.sleep", z.object({ minutes: z.number().int().min(0).max(1440) })),
  cmd("host.info", z.object({}).strict()),
  /**
   * Adds a folder to the host's allowed folders (the config file too). The app asks the person
   * first and sends `confirm: true`; the host refuses system folders and a connection outside
   * loopback and Tailscale.
   */
  cmd("roots.add", z.object({ path: z.string().min(1), confirm: z.boolean().optional() })),
  /** Lets a session of this host start with every permission check off; turning it on asks for `confirm`. */
  cmd("host.bypass", z.object({ allow: z.boolean(), confirm: z.boolean().optional() })),
  /** Keep this computer awake while sessions run: the host's switch (issue #163). */
  cmd("host.keepAwake", z.object({ enabled: z.boolean() }).strict()),
  /** Issue #1404: new card runs wait on the host while paused; near only. */
  cmd("host.pause", z.object({ paused: z.boolean() }).strict()),
  /** Issue #255: the last lines of the daemon's own log file, redacted and bounded. */
  cmd("logs.tail", z.object({ lines: z.number().int().min(1).max(500).optional() }).strict()),
  /** Issue #125: the latest releases of the app, with the Highlights of each release's notes. */
  cmd("releases.list", z.object({ limit: z.number().int().min(1).max(20).optional() }).strict()),
  cmd("maintenance.status", z.object({}).strict()),
  cmd("maintenance.backup", z.object({}).strict()),
  /** Applies the retention policy now; `dryRun` only counts. */
  cmd("maintenance.prune", z.object({ dryRun: z.boolean().optional() })),
  /** Phase 7: the daemon acks, then closes as on SIGTERM and exits with 0. */
  cmd("daemon.shutdown", z.object({}).strict()),
  /** Phase 9: downloads, verifies and applies the checked update; only with `confirm: true`. */
  cmd("daemon.update.apply", z.object({ confirm: z.boolean().optional() })),
  cmd("daemon.update.check", z.object({}).strict()),
  cmd("host.updates.set", z.object({ auto: z.boolean() })),
  /** #1200: installs the daemon as a service for the next boot or login: only with `confirm: true`. */
  cmd("service.install", z.object({ confirm: z.boolean().optional() }).strict()),
  cmd(
    "ui.set",
    z
      .object({
        mode: z.enum(["full", "simple"]).optional(),
        locked: z.boolean().optional(),
        confirm: z.boolean().optional(),
      })
      .strict(),
  ),
  /** The subfolders of a folder inside the allowed roots; without a path, the roots themselves. */
  cmd(
    "fs.dirs",
    z.object({ path: z.string().min(1).optional(), hidden: z.boolean().optional() }).strict(),
  ),
  /** The files of a folder inside the allowed roots (not the subfolders: `fs.dirs` has those). */
  cmd("fs.files", z.object({ path: z.string().min(1), hidden: z.boolean().optional() }).strict()),
  /** The host checks itself (version, claude, hooks, ports, folders): each failure carries its fix. */
  cmd("doctor.run", z.object({ appVersion: z.string().max(32).optional() }).strict()),
  /** The host's dependencies, required and optional, and what stops working without each. */
  cmd("deps.check", z.object({}).strict()),
] as const;

/** The `data` of each host command's ack; `CommandResults` extends it. */
export interface HostResults {
  "host.sleep": { sleepAfterMinutes: number };
  "host.info": HostInfoResult;
  "roots.add": RootsResult;
  "host.bypass": BypassResult;
  "host.keepAwake": KeepAwakeStatus;
  "host.pause": HostPauseStatus;
  "logs.tail": LogTail;
  "releases.list": ReleaseList;
  "maintenance.status": MaintenanceStatus;
  "maintenance.backup": BackupInfo;
  "maintenance.prune": PruneCounts;
  "daemon.shutdown": undefined;
  "daemon.update.apply": { started: true };
  "daemon.update.check": UpdateStatus;
  "host.updates.set": AutoUpdateStatus;
  "service.install": ServiceInstallResult;
  "ui.set": UiSettings;
  "fs.dirs": FsDirsResult;
  "doctor.run": DoctorResult;
  "deps.check": DepsResult;
  "fs.files": FsFilesResult;
}
