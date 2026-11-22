/**
 * Whether a `LocalForward` (`[bind:]port:host:port`, already checked by the save) listens beyond
 * this computer: it names a bind address that is not loopback. With no bind, OpenSSH listens on
 * loopback only.
 */
export function bindsBeyondLoopback(forward: string): boolean {
  const parts = forward.split(":");
  if (parts.length < 4) return false;
  const bind = (parts[0] ?? "").toLowerCase();
  return bind !== "localhost" && !/^127(?:\.\d{1,3}){3}$/.test(bind);
}
