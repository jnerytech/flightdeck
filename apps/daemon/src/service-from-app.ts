/**
 * Start at boot from the app (#1200): while the host is connected, the app's health check can
 * install the daemon as a service. It is enabled for the next boot or login, never started now:
 * the daemon that asked keeps running, and a handover that failed would leave the host offline
 * with no way back from the app. The app never runs sudo; it shows the linger line to copy.
 */
import type { ServiceContext } from "./service.ts";

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
  _self: readonly string[],
  _stable: string,
  _platform: string,
): boolean {
  return false;
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
  _deps: AppServiceDeps,
  _confirm: boolean,
): Promise<AppServiceResult> {
  return { startsAt: "boot", lingerOff: false, user: "" };
}
