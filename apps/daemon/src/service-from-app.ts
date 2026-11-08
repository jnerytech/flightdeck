/**
 * Start at boot from the app (#1200): while the host is connected, the app's health check can
 * install the daemon as a service. It is enabled for the next boot or login, never started now:
 * the daemon that asked keeps running, and a handover that failed would leave the host offline
 * with no way back from the app. The app never runs sudo; it shows the linger line to copy.
 */
import { FlightdeckError } from "./errors.ts";
import { lingerState } from "./linger.ts";
import { installService, resolveServiceClaude, type ServiceContext } from "./service.ts";

/** What the app is told after the install. */
export interface AppServiceResult {
  /** When the service first runs: at the next boot (Linux with linger on) or the next login. */
  startsAt: "boot" | "logon";
  /** Linux with linger off: the service only starts after a login until linger is on. */
  lingerOff: boolean;
  /** The account the linger line names. */
  user: string;
}

/**
 * Whether this daemon may install itself as a service from the app: on Linux or Windows, and only
 * when it runs as the stable binary a service would start. A daemon run from source (the demo, the
 * e2e journeys) or from elsewhere never offers it.
 */
export function appCanInstallService(
  self: readonly string[],
  stable: string,
  platform: string,
): boolean {
  if (platform !== "linux" && platform !== "win32") return false;
  return self.length === 1 && self[0] === stable;
}

export interface AppServiceDeps {
  /** The machine's service manager, with `command` set to the stable binary. */
  ctx: ServiceContext;
  /** The `--config` the service gets: only when the daemon itself was started with one. */
  config: string | null;
  /** Writes the `claude` the service will use into the config (a service has no shell PATH). */
  recordClaude(path: string): Promise<void>;
}

/** Installs and enables the service for the next boot or login; refused without `confirm`. */
export async function installServiceFromApp(
  deps: AppServiceDeps,
  confirm: boolean,
): Promise<AppServiceResult> {
  const { ctx } = deps;
  if (!confirm) {
    throw new FlightdeckError(
      "invalid_state",
      "installing the service on the host needs confirm: true",
      "service_confirm",
    );
  }
  const supported =
    ctx.platform === "win32" || (ctx.platform === "linux" && ctx.which("systemctl") !== null);
  if (!supported) {
    throw new FlightdeckError(
      "invalid_state",
      `this host has no service manager to start flightdeckd at boot (${ctx.platform})`,
      "service_unsupported",
      { platform: ctx.platform },
    );
  }
  // systemd with no user bus (an SSH login without XDG_RUNTIME_DIR, a container) would fail
  // after the unit is written: refuse before touching anything.
  if (ctx.platform === "linux") {
    const bus = await ctx.exec(["systemctl", "--user", "show-environment"]);
    if (bus.code !== 0) {
      throw new FlightdeckError(
        "invalid_state",
        "systemd has no user session for this account, so it cannot start flightdeckd at boot",
        "service_unsupported",
        { platform: ctx.platform },
      );
    }
  }
  await installService(ctx, deps.config, { start: false });
  // Only an install that went through changes the config.
  const claude = resolveServiceClaude(ctx);
  if (claude.path) await deps.recordClaude(claude.path);
  const linger = await lingerState(ctx);
  return {
    startsAt: ctx.platform === "linux" && linger === "on" ? "boot" : "logon",
    lingerOff: linger === "off",
    user: ctx.user,
  };
}
