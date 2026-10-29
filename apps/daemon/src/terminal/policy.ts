import { DEFAULT_ALLOWED_NETWORKS, ipInNetworks } from "../networks.ts";

/** Whether the daemon listens only on this machine (127.x, ::1 or localhost). */
export function loopbackBind(bind: string): boolean {
  return bind === "localhost" || ipInNetworks(bind, DEFAULT_ALLOWED_NETWORKS);
}

/**
 * `terminal.enabled` of the config; without it, on when the daemon only listens in loopback and
 * off when it accepts other networks (a terminal is a full shell on the host).
 */
export function terminalEnabled(bind: string, enabled: boolean | undefined): boolean {
  return enabled ?? loopbackBind(bind);
}
