/** Stub. */
import type { VaultRequester } from "@flightdeck/protocol";

export const VAULT_NETWORKS = ["127.0.0.0/8", "::1/128"];

/** Stub. */
export function isVaultTransport(_address: string): boolean {
  return true;
}

export interface VaultDelivery {
  secretId: string;
  value: string;
  purpose: string;
  expiresAt: number;
  requester: VaultRequester;
}

export interface VaultOptions {
  clock?: () => number;
  /** At most this long in memory (60 s when absent). */
  ttlMs?: number;
  log?: (message: string) => void;
  /** What a delivered secret can be used for; each takes the value and answers a text. */
  actions?: Record<string, (value: string) => string>;
}

/** Stub. */
export class Vault {
  constructor(readonly opts: VaultOptions = {}) {}

  deliver(_input: VaultDelivery, _origin: string): { expiresAt: number } {
    return { expiresAt: 0 };
  }

  use(
    _secretId: string,
    _purpose: string,
    _action: string,
  ): { result: string; requester: VaultRequester } {
    return { result: "", requester: "claude" };
  }

  held(): number {
    return 99;
  }

  stop(): void {}
}
