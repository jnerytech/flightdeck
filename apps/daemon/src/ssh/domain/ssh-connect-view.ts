/** Issue #3537: what `flightdeckd ssh hostkey check|test` print, as pure rules over the daemon's answers. */
import type { SshHostKeyCheck, SshTestResult } from "@flightdeck/protocol";

/** The line for a host key check; only a pinned key that matches is exit 0, so a script can gate on it. */
export function hostKeyLine(
  name: string,
  check: SshHostKeyCheck,
): { line: string; code: 0 | 1; reason?: string } {
  if (check.status === "pinned") {
    return { line: `${name}: host key pinned, ${check.fingerprint}`, code: 0 };
  }
  if (check.status === "unknown") {
    return {
      line: `${name}: host key not pinned yet, the server shows ${check.fingerprint}`,
      code: 1,
      reason: "host_key_unknown",
    };
  }
  return {
    line: `${name}: host key CHANGED, pinned ${check.pinned ?? "none"}, the server shows ${check.fingerprint}`,
    code: 1,
    reason: "host_key_changed",
  };
}

/** The line for a connection test: reachable and logged in is exit 0, anything else exit 1 with the daemon's words. */
export function testLine(name: string, result: SshTestResult): { line: string; code: 0 | 1 } {
  if (result.ok) return { line: `${name}: reachable`, code: 0 };
  return { line: `${name}: failed, ${result.error ?? "no reason given"}`, code: 1 };
}
