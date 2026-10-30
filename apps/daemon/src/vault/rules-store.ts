/**
 * Phase 19: the rules of each secret, as the app handed them over. The rules belong to the app,
 * which is who finally delivers a secret; the daemon keeps a copy in memory to decide a request
 * the same way and to refuse at once what no rule or default lets through. After a restart the
 * app sends them again, and until then the safe defaults decide.
 */
import type { Rule } from "./rules.ts";

export class VaultRules {
  /** Validates and replaces the rules of a secret; returns how many. */
  set(_secretId: string, _tags: readonly string[], _raw: unknown): number {
    return 0;
  }

  get(_secretId: string): { tags: string[]; rules: Rule[] } {
    return { tags: [], rules: [] };
  }

  rulesFor(_secretId: string): Rule[] {
    return [];
  }

  tagsFor(_secretId: string): string[] {
    return [];
  }
}
