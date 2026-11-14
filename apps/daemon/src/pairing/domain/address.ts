const LOOPBACK_BINDS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/** Whether the daemon listens only on this machine (a link with another address would not connect). */
export function loopbackOnly(bind: string): boolean {
  return LOOPBACK_BINDS.has(bind);
}

/**
 * Address put in the pairing link: what the daemon listens on. The Tailscale IP only enters when
 * the daemon listens on every interface (or on that very IP): a daemon on the loopback is not
 * reachable through it, and a link that cannot connect is worse than none.
 */
export function pairingAddress(bind: string, tailscaleIp: string | null): string {
  if (bind === "0.0.0.0" || bind === "::") {
    return tailscaleIp ?? (bind === "::" ? "::1" : "127.0.0.1");
  }
  return bind;
}
