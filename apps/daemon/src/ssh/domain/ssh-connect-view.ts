/** Issue #3537: what `flightdeckd ssh hostkey check|confirm|forget|test` print and decide, as pure rules over the daemon's answers. */
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

/**
 * Whether a typed fingerprint may be sent to `ssh.hostkey.confirm`: only for a server key not pinned yet, and
 * only when it is the one the server shows now. The fingerprint sent is the one the person typed, never the
 * one the check returned, so a key that changed between the person's look and this call pins nothing.
 */
export function confirmDecision(
  name: string,
  check: SshHostKeyCheck,
  typed: string,
): { send: true } | { send: false; message: string; reason: string } {
  if (check.status === "pinned") {
    return {
      send: false,
      message: `${name}: host key already pinned, ${check.fingerprint}: nothing to confirm`,
      reason: "ssh_hostkey_exists",
    };
  }
  if (check.status === "changed") {
    return {
      send: false,
      message: `${name}: host key CHANGED, pinned ${check.pinned ?? "none"}, the server shows ${check.fingerprint}: a new key is never pinned over the old one; run flightdeckd ssh hostkey forget ${name} if you trust the change, then check and confirm again`,
      reason: "host_key_changed",
    };
  }
  if (typed !== check.fingerprint) {
    return {
      send: false,
      message: `${name}: the server shows ${check.fingerprint}, not ${typed}: nothing was pinned`,
      reason: "ssh_hostkey_mismatch",
    };
  }
  return { send: true };
}

export const hostKeyPinnedLine = (name: string, fingerprint: string) =>
  `${name}: host key pinned, ${fingerprint}`;

export const hostKeyForgottenLine = (name: string) =>
  `${name}: pinned host key forgotten, the next check shows the server key again`;
