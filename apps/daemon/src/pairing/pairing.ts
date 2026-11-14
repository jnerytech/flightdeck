import { generateToken, updateConfigFile } from "../config.ts";
import type { Exec } from "../kernel/index.ts";
import { tailscaleAddress } from "./domain/tailscale.ts";

/** `tailscale ip -4`, or `null` when Tailscale is missing, fails or is not logged in. */
export async function tailscaleIp(exec: Exec): Promise<string | null> {
  try {
    return tailscaleAddress(await exec(["tailscale", "ip", "-4"]));
  } catch {
    return null;
  }
}

/** Replaces the token in the config file (atomically), keeping every other field. */
export async function rotateToken(file: string): Promise<string> {
  const token = generateToken();
  await updateConfigFile(file, (raw) => ({ ...raw, token }));
  return token;
}
