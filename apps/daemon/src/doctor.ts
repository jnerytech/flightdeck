import { loopbackOnly } from "./pairing.ts";
import { VERIFIED_OPENCODE_VERSION } from "./runtime/opencode-config.ts";
import type { OpenCodeInfo } from "./runtime/opencode-discovery.ts";
import { findingText, type ScopeFinding } from "./runtime/opencode-scope.ts";

type HooksState = "installed" | "absent" | "outdated";

export interface DoctorDeps {
  /** The config; throws with the cause when it cannot be read. */
  config():
    | { bind: string; port: number; allowedRoots: string[] }
    | Promise<{ bind: string; port: number; allowedRoots: string[] }>;
  isDirectory(path: string): boolean | Promise<boolean>;
  serviceInstalled(): Promise<boolean>;
  healthy(): Promise<boolean>;
  /** When nothing healthy answers: the address the daemon refused, if that is why. */
  refused?(): Promise<string | null>;
  tailscaleIp(): Promise<string | null>;
  hooks(): HooksState | Promise<HooksState>;
  claudePath(): string | null;
  /** Whether the Flightdeck MCP server managed sessions get can start: its command, and whether that file exists. */
  mcp?(): Promise<{ command: string; exists: boolean }>;
  /** Whether the user's systemd keeps running without a login (Linux); null where it does not apply. */
  linger?(): Promise<"on" | "off" | null>;
  /** Template files the host could not load (phase 33); absent when it has no templates. */
  templateProblems?(): Promise<Array<{ file: string; reason: string }>>;
  /** Phase 39: OpenCode on this host: turned on or not, where it is, what discovery said. */
  opencode?(): Promise<OpenCodeState>;
  /** The running daemon's version and, when the app told it, the app's: only a running daemon has them. */
  version?: { daemon: string; app?: string };
}

/** A stable key per check, so the app can name it and say how to fix it in its own language. */
export type DoctorCheckId =
  | "config"
  | "folders"
  | "service"
  | "daemon"
  | "claude"
  | "hooks"
  | "tailscale"
  | "version"
  | "templates"
  | "mcp"
  | "linger"
  | "opencode";

export interface DoctorCheck {
  id: DoctorCheckId;
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** What to run; absent when the check passed. */
  fix?: string;
}

const check = (
  id: DoctorCheckId,
  name: string,
  status: DoctorCheck["status"],
  detail: string,
  fix?: string,
): DoctorCheck => ({ id, name, status, detail, ...(fix ? { fix } : {}) });

export interface OpenCodeState {
  enabled: boolean;
  /** The executable on PATH, looked up without running it. */
  found: string | null;
  /** What discovery said, when OpenCode is turned on. */
  info: OpenCodeInfo | null;
  platform: NodeJS.Platform;
}

/** Phase 39: the OpenCode row; never a failure (OpenCode is optional). */
export function opencodeCheck(state: OpenCodeState): DoctorCheck {
  const { enabled, found, info, platform } = state;
  if (!enabled) {
    return found
      ? check(
          "opencode",
          "opencode",
          "warn",
          `OpenCode is installed (${found}) but turned off on this host`,
          'set "opencode": { "enabled": true } in the host config, then restart the daemon',
        )
      : check("opencode", "opencode", "ok", "OpenCode is not installed (optional)");
  }
  if (!info?.available) {
    return check(
      "opencode",
      "opencode",
      "warn",
      `OpenCode is turned on but not available: ${info?.reason ?? "unknown"}${scopeFindings(info?.findings)}`,
      "see the OpenCode section of the manual for this reason, then restart the daemon",
    );
  }
  const what = `OpenCode ${info.version} (${info.path})`;
  if (!info.verified) {
    return check(
      "opencode",
      "opencode",
      "warn",
      `${what} is not the version Flightdeck verified (${VERIFIED_OPENCODE_VERSION})`,
    );
  }
  // ADR 39-1: the scope scan's folders on Windows and macOS were not checked against OpenCode.
  return platform === "linux"
    ? check("opencode", "opencode", "ok", what)
    : check(
        "opencode",
        "opencode",
        "warn",
        `${what}; its global and system config folders are unverified on this OS`,
      );
}

/** What the scope scan found, for the person to remove: `: kind detail (path); ...`. */
/** The daemon's check: answering, refusing this machine's address, or not answering at all. */
function daemonCheck(healthy: boolean, refused: string | null, address: string): DoctorCheck {
  if (healthy) return check("daemon", "daemon", "ok", `answering on ${address}`);
  if (refused) {
    return check(
      "daemon",
      "daemon",
      "fail",
      `the daemon refused this machine's address (${refused}): add its network to allowedNetworks (or run flightdeckd setup)`,
      "run: flightdeckd setup (it adds the Tailscale networks), or add the network to allowedNetworks in the config",
    );
  }
  return check(
    "daemon",
    "daemon",
    "fail",
    `nothing answers on ${address}`,
    "run: flightdeckd service start (or flightdeckd start, in a terminal, to see the error)",
  );
}

/** A template file that could not be loaded, with why. */
const templateProblem = (p: { file: string; reason: string }) => `${p.file} (${p.reason})`;

function scopeFindings(findings: ScopeFinding[] | undefined): string {
  if (!findings?.length) return "";
  return `: ${findings.map(findingText).join("; ")}`;
}

const minor = (version: string) => version.split(".").slice(0, 2).join(".");

/** The daemon and the app are meant to run the same major.minor: the protocol moves with it. */
function versionCheck(version: { daemon: string; app?: string }): DoctorCheck {
  const { daemon, app } = version;
  if (app === undefined || minor(app) === minor(daemon))
    return check("version", "version", "ok", daemon);
  return check(
    "version",
    "version",
    "warn",
    `the daemon is ${daemon} and the app is ${app}: some features may be missing`,
    "run: flightdeckd update",
  );
}

const SETUP = "run: flightdeckd setup";

/** The project folders: at least one allowed, and each still a folder. */
function foldersCheck(allowedRoots: string[], gone: string[]): DoctorCheck {
  if (allowedRoots.length === 0) {
    return check(
      "folders",
      "project folders",
      "fail",
      "no folder allowed: no session can start",
      SETUP,
    );
  }
  if (gone.length > 0) {
    return check(
      "folders",
      "project folders",
      "fail",
      `not a folder anymore: ${gone.join(", ")}`,
      SETUP,
    );
  }
  return check("folders", "project folders", "ok", allowedRoots.join(", "));
}

function serviceCheck(installed: boolean): DoctorCheck {
  if (installed) return check("service", "service", "ok", "installed");
  return check(
    "service",
    "service",
    "fail",
    "no service installed: the daemon will not start by itself",
    SETUP,
  );
}

function claudeCheck(claude: string | null | undefined): DoctorCheck {
  if (claude) return check("claude", "claude", "ok", claude);
  return check(
    "claude",
    "claude",
    "warn",
    "claude is not on the PATH: sessions cannot start",
    "install Claude Code, then run: flightdeckd service install",
  );
}

function mcpCheck(mcp: { exists: boolean; command: string }): DoctorCheck {
  if (mcp.exists) return check("mcp", "mcp", "ok", mcp.command);
  return check(
    "mcp",
    "mcp",
    "warn",
    `${mcp.command} is gone: sessions start without the team tools (send_to_session, list_sessions)`,
    SETUP,
  );
}

function lingerCheck(linger: "on" | "off"): DoctorCheck {
  if (linger === "on") return check("linger", "linger", "ok", "on: the daemon starts at boot");
  return check(
    "linger",
    "linger",
    "fail",
    "off: the daemon will not start after a reboot (or after WSL restarts) until you log in",
    "run: sudo loginctl enable-linger $USER",
  );
}

function hooksCheck(hooks: string): DoctorCheck {
  if (hooks === "installed") return check("hooks", "hooks", "ok", "installed");
  return check(
    "hooks",
    "hooks",
    "warn",
    `${hooks}: live session status is limited`,
    "run: flightdeckd hooks install",
  );
}

function tailscaleCheck(tailscale: string | null, bind: string): DoctorCheck {
  if (tailscale && loopbackOnly(bind)) {
    return check(
      "tailscale",
      "tailscale",
      "warn",
      `Tailscale is up (${tailscale}) but the daemon listens only on ${bind}: other devices cannot connect`,
      SETUP,
    );
  }
  return check("tailscale", "tailscale", "ok", tailscale ?? "not in use");
}

/** Checks what a first run needs, one line per thing, each failure with its fix. */
export async function runDoctor(deps: DoctorDeps): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  let config: Awaited<ReturnType<DoctorDeps["config"]>>;
  try {
    config = await deps.config();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, checks: [check("config", "config", "fail", detail, SETUP)] };
  }
  const checks = [check("config", "config", "ok", "readable")];

  const found = await Promise.all(config.allowedRoots.map(async (root) => deps.isDirectory(root)));
  const gone = config.allowedRoots.filter((_, index) => !found[index]);
  checks.push(foldersCheck(config.allowedRoots, gone));
  checks.push(serviceCheck(await deps.serviceInstalled()));

  const address = `${config.bind}:${config.port}`;
  const healthy = await deps.healthy();
  const refused = healthy ? null : ((await deps.refused?.()) ?? null);
  checks.push(daemonCheck(healthy, refused, address));

  checks.push(claudeCheck(deps.claudePath()));

  const opencode = await deps.opencode?.();
  if (opencode) checks.push(opencodeCheck(opencode));

  const brokenTemplates = (await deps.templateProblems?.()) ?? [];
  if (brokenTemplates.length > 0) {
    checks.push(
      check(
        "templates",
        "templates",
        "warn",
        `could not load: ${brokenTemplates.map(templateProblem).join("; ")}`,
        "fix or remove those files in the templates folder",
      ),
    );
  }

  const mcp = await deps.mcp?.();
  if (mcp) checks.push(mcpCheck(mcp));

  const linger = await deps.linger?.();
  if (linger) checks.push(lingerCheck(linger));

  checks.push(hooksCheck(await deps.hooks()));
  checks.push(tailscaleCheck(await deps.tailscaleIp(), config.bind));

  if (deps.version) checks.push(versionCheck(deps.version));

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
