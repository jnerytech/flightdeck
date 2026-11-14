import QRCode from "qrcode";
import { generateToken, updateConfigFile } from "../config.ts";
import type { Exec } from "../kernel/index.ts";

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
export async function rotateToken(file: string): Promise<string> {
  const token = generateToken();
  await updateConfigFile(file, (raw) => ({ ...raw, token }));
  return token;
}
