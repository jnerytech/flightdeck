import QRCode from "qrcode";
import { generateToken, updateConfigFile } from "./config.ts";
import type { Exec } from "./exec.ts";

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

/** `tailscale ip -4`, or `null` when Tailscale is missing, fails or is not logged in. */
export async function tailscaleIp(exec: Exec): Promise<string | null> {
  try {
    const { code, stdout } = await exec(["tailscale", "ip", "-4"]);
    return code === 0 ? stdout.trim().split("\n")[0] || null : null;
  } catch {
    return null;
  }
}

export function renderQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: "utf8" });
}

/** Replaces the token in the config file (atomically), keeping every other field. */
export function rotateToken(file: string): string {
  const token = generateToken();
  updateConfigFile(file, (raw) => ({ ...raw, token }));
  return token;
}
