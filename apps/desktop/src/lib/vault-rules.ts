import type { Platform } from "../platform/types.ts";

/**
 * Phase 19: the usage rules of each secret, kept by the app with the vault. The daemon only holds
 * a copy in memory, which the app hands it on connect and after each change.
 */
const KEY = "flightdeck.vaultRules";

export class VaultRules {
  constructor(private readonly storage: Platform["storage"]) {}

  /** Every secret's rules, by secret id. */
  all(): Record<string, unknown[]> {
    const raw = this.storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
  }

  /** A secret's rules, in order (the first that matches decides); none when it has no rules. */
  get(secretId: string): unknown[] {
    return this.all()[secretId] ?? [];
  }

  set(secretId: string, rules: unknown[]): void {
    this.storage.setItem(KEY, JSON.stringify({ ...this.all(), [secretId]: rules }));
  }
}
