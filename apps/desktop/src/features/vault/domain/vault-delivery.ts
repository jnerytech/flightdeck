import type { Vault } from "../vault.ts";

/** What a delivery check needs: the host's id and address, and the vault to ask. */
export interface DeliveryDeps {
  hostId: string;
  hostUrl: string;
  vault: Pick<Vault, "list" | "value">;
}

/** True when the connection to the host is loopback or Tailscale, which are encrypted or local. */
export function transportAllowed(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "[::1]") return true;
  if (hostname.startsWith("[fd7a:115c:a1e0:")) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return first === 127 || (first === 100 && second >= 64 && second <= 127);
}

export type DeliveryRefusal = "not-found" | "not-allowed" | "transport" | "no-value";

export type DeliveryCheck =
  | { ok: true; value: string }
  | { ok: false; code: DeliveryRefusal; reason: string };

const REFUSALS: Record<DeliveryRefusal, string> = {
  "not-found": "the vault has no such secret",
  "not-allowed": "the secret is not allowed for this host",
  transport: "the vault only delivers over loopback or Tailscale, which WireGuard encrypts",
  "no-value": "the secret's value is missing from the system vault",
};

/**
 * The rules a delivery always obeys, whoever asks: the secret exists, it is allowed for this
 * host (by id), the connection is loopback or Tailscale, and its value is in the system vault.
 */
export async function checkDelivery(secretId: string, deps: DeliveryDeps): Promise<DeliveryCheck> {
  const refuse = (code: DeliveryRefusal): DeliveryCheck => ({
    ok: false,
    code,
    reason: REFUSALS[code],
  });
  const secret = deps.vault.list().find((s) => s.id === secretId);
  if (!secret) return refuse("not-found");
  if (!secret.allowedHosts.includes(deps.hostId)) return refuse("not-allowed");
  if (!transportAllowed(deps.hostUrl)) return refuse("transport");
  const value = await deps.vault.value(secret.id);
  return value === null ? refuse("no-value") : { ok: true, value };
}
