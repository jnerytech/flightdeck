import { loopbackOnly } from "./pairing.ts";

export interface DoctorDeps {
  /** The config; throws with the cause when it cannot be read. */
  config(): { bind: string; port: number; allowedRoots: string[] };
  isDirectory(path: string): boolean;
  serviceInstalled(): Promise<boolean>;
  healthy(): Promise<boolean>;
  tailscaleIp(): Promise<string | null>;
  hooks(): "installed" | "absent" | "outdated";
  claudePath(): string | null;
}

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  /** What to run; absent when the check passed. */
  fix?: string;
}

const check = (
  name: string,
  status: DoctorCheck["status"],
  detail: string,
  fix?: string,
): DoctorCheck => ({ name, status, detail, ...(fix ? { fix } : {}) });

const SETUP = "run: flightdeckd setup";

/** Checks what a first run needs, one line per thing, each failure with its fix. */
export async function runDoctor(deps: DoctorDeps): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  let config: ReturnType<DoctorDeps["config"]>;
  try {
    config = deps.config();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, checks: [check("config", "fail", detail, SETUP)] };
  }
  const checks = [check("config", "ok", "readable")];

  const gone = config.allowedRoots.filter((root) => !deps.isDirectory(root));
  if (config.allowedRoots.length === 0) {
    checks.push(check("project folders", "fail", "no folder allowed: no session can start", SETUP));
  } else if (gone.length) {
    checks.push(
      check("project folders", "fail", `not a folder anymore: ${gone.join(", ")}`, SETUP),
    );
  } else {
    checks.push(check("project folders", "ok", config.allowedRoots.join(", ")));
  }

  checks.push(
    (await deps.serviceInstalled())
      ? check("service", "ok", "installed")
      : check(
          "service",
          "fail",
          "no service installed: the daemon will not start by itself",
          SETUP,
        ),
  );

  const address = `${config.bind}:${config.port}`;
  checks.push(
    (await deps.healthy())
      ? check("daemon", "ok", `answering on ${address}`)
      : check(
          "daemon",
          "fail",
          `nothing answers on ${address}`,
          "run: flightdeckd service start (or flightdeckd start, in a terminal, to see the error)",
        ),
  );

  const claude = deps.claudePath();
  checks.push(
    claude
      ? check("claude", "ok", claude)
      : check(
          "claude",
          "warn",
          "claude is not on the PATH: sessions cannot start",
          "install Claude Code, then run: flightdeckd service install",
        ),
  );

  const hooks = deps.hooks();
  checks.push(
    hooks === "installed"
      ? check("hooks", "ok", "installed")
      : check(
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
          "warn",
          `Tailscale is up (${tailscale}) but the daemon listens only on ${config.bind}: other devices cannot connect`,
          SETUP,
        )
      : check("tailscale", "ok", tailscale ?? "not in use"),
  );

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
