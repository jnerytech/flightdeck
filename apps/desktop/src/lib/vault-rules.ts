import type { Platform } from "../platform/types.ts";

/**
 * Phase 19: the usage rules of each secret, kept by the app with the vault. The daemon only holds
 * a copy in memory, which the app hands it on connect and after each change.
 */
export class VaultRules {
  constructor(private readonly storage: Platform["storage"]) {}

  /** A secret's rules, in order (the first that matches decides); none when it has no rules. */
  get(_secretId: string): unknown[] {
    return [];
  }

  set(_secretId: string, _rules: unknown[]): void {}
}
