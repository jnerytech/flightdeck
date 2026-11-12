import { z } from "zod";
import { readStored, validValues } from "@/shared/lib/index.ts";
import type { Platform } from "../../platform/types.ts";

/**
 * Phase 19: the usage rules of each secret, kept by the app with the vault. The daemon only holds
 * a copy in memory, which the app hands it on connect and after each change.
 */
const KEY = "flightdeck.vaultRules";

/** What is kept: a secret whose rules are not a list has none. */
const Stored = validValues(z.array(z.unknown()));

export class VaultRules {
  constructor(private readonly storage: Platform["storage"]) {}

  /** Every secret's rules, by secret id. */
  all(): Record<string, unknown[]> {
    return readStored(this.storage, KEY, Stored, {});
  }

  /** A secret's rules, in order (the first that matches decides); none when it has no rules. */
  get(secretId: string): unknown[] {
    return this.all()[secretId] ?? [];
  }

  set(secretId: string, rules: unknown[]): void {
    this.storage.setItem(KEY, JSON.stringify({ ...this.all(), [secretId]: rules }));
  }
}
