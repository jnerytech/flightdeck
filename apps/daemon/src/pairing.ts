import QRCode from "qrcode";
import { generateToken, updateConfigFile } from "./config.ts";
import type { Exec } from "./exec.ts";

/** Address put in the pairing link: the Tailscale IP when there is one, else the bind. */
export function pairingAddress(bind: string, tailscaleIp: string | null): string {
  if (tailscaleIp) return tailscaleIp;
  if (bind === "0.0.0.0") return "127.0.0.1";
  if (bind === "::") return "::1";
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
