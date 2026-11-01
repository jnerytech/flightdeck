/**
 * Phase 19: the rules of each secret, as the app handed them over. The rules belong to the app,
 * which is who finally delivers a secret; the daemon keeps a copy in memory to decide a request
 * the same way and to refuse at once what no rule or default lets through. After a restart the
 * app sends them again, and until then the safe defaults decide.
 */
import { FlightdeckError } from "../errors.ts";
import { type Rule, validateRules } from "./rules.ts";

interface Held {
  tags: string[];
  rules: Rule[];
}

export class VaultRules {
  private readonly bySecret = new Map<string, Held>();

  /**
   * Validates and replaces the rules of a secret; returns how many. Rules that break the ceiling
   * or are malformed are refused as a whole, and the previous ones stay.
   */
  set(secretId: string, tags: readonly string[], raw: unknown): number {
    const { rules, errors } = validateRules(raw);
    if (errors.length > 0) {
      throw new FlightdeckError(
        "bad_request",
        errors.map((e) => String(e.params?.message)).join("; "),
      );
    }
    this.bySecret.set(secretId, {
      tags: [...new Set(tags.map((tag) => tag.toLowerCase()))],
      rules,
    });
    return rules.length;
  }

  get(secretId: string): Held {
    return this.bySecret.get(secretId) ?? { tags: [], rules: [] };
  }

  rulesFor(secretId: string): Rule[] {
    return this.get(secretId).rules;
  }

  /** The tags of the secret itself (the app knows them); the action adds its own. */
  tagsFor(secretId: string): string[] {
    return this.get(secretId).tags;
  }
}
