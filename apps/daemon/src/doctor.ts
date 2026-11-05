import { loopbackOnly } from "./pairing.ts";

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
  | "linger";

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

type Config = Awaited<ReturnType<DoctorDeps["config"]>>;

async function foldersCheck(config: Config, deps: DoctorDeps): Promise<DoctorCheck> {
  const found = await Promise.all(config.allowedRoots.map(async (root) => deps.isDirectory(root)));
  const gone = config.allowedRoots.filter((_, index) => !found[index]);
  if (config.allowedRoots.length === 0) {
    return check(
      "folders",
      "project folders",
      "fail",
      "no folder allowed: no session can start",
      SETUP,
    );
  }
  if (gone.length) {
    return check(
      "folders",
      "project folders",
      "fail",
      `not a folder anymore: ${gone.join(", ")}`,
      SETUP,
    );
  }
  return check("folders", "project folders", "ok", config.allowedRoots.join(", "));
}

async function serviceCheck(deps: DoctorDeps): Promise<DoctorCheck> {
  return (await deps.serviceInstalled())
    ? check("service", "service", "ok", "installed")
    : check(
        "service",
        "service",
        "fail",
        "no service installed: the daemon will not start by itself",
        SETUP,
      );
}

async function daemonCheck(config: Config, deps: DoctorDeps): Promise<DoctorCheck> {
  const address = `${config.bind}:${config.port}`;
  if (await deps.healthy()) return check("daemon", "daemon", "ok", `answering on ${address}`);
  const refused = (await deps.refused?.()) ?? null;
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

function claudeCheck(deps: DoctorDeps): DoctorCheck {
  const claude = deps.claudePath();
  return claude
    ? check("claude", "claude", "ok", claude)
    : check(
        "claude",
        "claude",
        "warn",
        "claude is not on the PATH: sessions cannot start",
        "install Claude Code, then run: flightdeckd service install",
      );
}

/** A warning when some template file could not load; nothing otherwise. */
async function templatesCheck(deps: DoctorDeps): Promise<DoctorCheck | null> {
  const broken = (await deps.templateProblems?.()) ?? [];
  if (broken.length === 0) return null;
  return check(
    "templates",
    "templates",
    "warn",
    "could not load: " + broken.map((p) => p.file + " (" + p.reason + ")").join("; "),
    "fix or remove those files in the templates folder",
  );
}

async function mcpCheck(deps: DoctorDeps): Promise<DoctorCheck | null> {
  const mcp = await deps.mcp?.();
  if (!mcp) return null;
  return mcp.exists
    ? check("mcp", "mcp", "ok", mcp.command)
    : check(
        "mcp",
        "mcp",
        "warn",
        `${mcp.command} is gone: sessions start without the team tools (send_to_session, list_sessions)`,
        SETUP,
      );
}

async function lingerCheck(deps: DoctorDeps): Promise<DoctorCheck | null> {
  const linger = await deps.linger?.();
  if (!linger) return null;
  return linger === "on"
    ? check("linger", "linger", "ok", "on: the daemon starts at boot")
    : check(
        "linger",
        "linger",
        "fail",
        "off: the daemon will not start after a reboot (or after WSL restarts) until you log in",
        "run: sudo loginctl enable-linger $USER",
      );
}

async function hooksCheck(deps: DoctorDeps): Promise<DoctorCheck> {
  const hooks = await deps.hooks();
  return hooks === "installed"
    ? check("hooks", "hooks", "ok", "installed")
    : check(
        "hooks",
        "hooks",
        "warn",
        `${hooks}: live session status is limited`,
        "run: flightdeckd hooks install",
      );
}

async function tailscaleCheck(config: Config, deps: DoctorDeps): Promise<DoctorCheck> {
  const tailscale = await deps.tailscaleIp();
  return tailscale && loopbackOnly(config.bind)
    ? check(
        "tailscale",
        "tailscale",
        "warn",
        `Tailscale is up (${tailscale}) but the daemon listens only on ${config.bind}: other devices cannot connect`,
        SETUP,
      )
    : check("tailscale", "tailscale", "ok", tailscale ?? "not in use");
}

/** Checks what a first run needs, one line per thing, each failure with its fix. */
export async function runDoctor(deps: DoctorDeps): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  let config: Config;
  try {
    config = await deps.config();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, checks: [check("config", "config", "fail", detail, SETUP)] };
  }
  // Sequential on purpose: the checks run in the order they are listed, one probe at a time.
  const checks = [check("config", "config", "ok", "readable")];
  checks.push(await foldersCheck(config, deps));
  checks.push(await serviceCheck(deps));
  checks.push(await daemonCheck(config, deps));
  checks.push(claudeCheck(deps));
  for (const optional of [
    await templatesCheck(deps),
    await mcpCheck(deps),
    await lingerCheck(deps),
  ]) {
    if (optional) checks.push(optional);
  }
  checks.push(await hooksCheck(deps));
  checks.push(await tailscaleCheck(config, deps));
  if (deps.version) checks.push(versionCheck(deps.version));

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
