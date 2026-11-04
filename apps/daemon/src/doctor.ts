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
  tailscaleIp(): Promise<string | null>;
  hooks(): HooksState | Promise<HooksState>;
  claudePath(): string | null;
  /** Whether the Flightdeck MCP server managed sessions get can start: its command, and whether that file exists. */
  mcp?(): Promise<{ command: string; exists: boolean }>;
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
  | "mcp";

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

  const found = await Promise.all(config.allowedRoots.map((root) => deps.isDirectory(root)));
  const gone = config.allowedRoots.filter((_, index) => !found[index]);
  if (config.allowedRoots.length === 0) {
    checks.push(
      check("folders", "project folders", "fail", "no folder allowed: no session can start", SETUP),
    );
  } else if (gone.length) {
    checks.push(
      check(
        "folders",
        "project folders",
        "fail",
        `not a folder anymore: ${gone.join(", ")}`,
        SETUP,
      ),
    );
  } else {
    checks.push(check("folders", "project folders", "ok", config.allowedRoots.join(", ")));
  }

  checks.push(
    (await deps.serviceInstalled())
      ? check("service", "service", "ok", "installed")
      : check(
          "service",
          "service",
          "fail",
          "no service installed: the daemon will not start by itself",
          SETUP,
        ),
  );

  const address = `${config.bind}:${config.port}`;
  checks.push(
    (await deps.healthy())
      ? check("daemon", "daemon", "ok", `answering on ${address}`)
      : check(
          "daemon",
          "daemon",
          "fail",
          `nothing answers on ${address}`,
          "run: flightdeckd service start (or flightdeckd start, in a terminal, to see the error)",
        ),
  );

  const claude = deps.claudePath();
  checks.push(
    claude
      ? check("claude", "claude", "ok", claude)
      : check(
          "claude",
          "claude",
          "warn",
          "claude is not on the PATH: sessions cannot start",
          "install Claude Code, then run: flightdeckd service install",
        ),
  );

  const brokenTemplates = (await deps.templateProblems?.()) ?? [];
  if (brokenTemplates.length > 0) {
    checks.push(
      check(
        "templates",
        "templates",
        "warn",
        `could not load: ${brokenTemplates.map((p) => `${p.file} (${p.reason})`).join("; ")}`,
        "fix or remove those files in the templates folder",
      ),
    );
  }

  const mcp = await deps.mcp?.();
  if (mcp) {
    checks.push(
      mcp.exists
        ? check("mcp", "mcp", "ok", mcp.command)
        : check(
            "mcp",
            "mcp",
            "warn",
            `${mcp.command} is gone: sessions start without the team tools (send_to_session, list_sessions)`,
            SETUP,
          ),
    );
  }

  const hooks = await deps.hooks();
  checks.push(
    hooks === "installed"
      ? check("hooks", "hooks", "ok", "installed")
      : check(
          "hooks",
          "hooks",
          "warn",
          `${hooks}: live session status is limited`,
          "run: flightdeckd hooks install",
        ),
  );

  const tailscale = await deps.tailscaleIp();
  checks.push(
    tailscale && loopbackOnly(config.bind)
      ? check(
          "tailscale",
          "tailscale",
          "warn",
          `Tailscale is up (${tailscale}) but the daemon listens only on ${config.bind}: other devices cannot connect`,
          SETUP,
        )
      : check("tailscale", "tailscale", "ok", tailscale ?? "not in use"),
  );

  if (deps.version) checks.push(versionCheck(deps.version));

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
