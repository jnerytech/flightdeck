/**
 * Phase 36: nothing about money reaches a daemon. The roll-up answers counts, tokens and the cost the
 * agents ran up; a rate, a price, a billed amount or a value of the work lives in the app only.
 */

/** Words that say money on the person's side: a rate, a price, a billed amount (whole words, or a camel-case part). */
export const MONEY_WORDS =
  /(?:^|[^A-Za-z])rates?(?:[^a-z]|$)|[a-z]Rates?(?:[^a-z]|$)|price|billed|billing|hourly|currency|invoice|revenue|profit|salary|money/i;

/** In a field name, a "value" of the work is money too. */
export const FIELD_WORDS = new RegExp(`${MONEY_WORDS.source}|value`, "i");

/** The cost the agents ran up is a fact the daemon already keeps; these three carry it. */
export const COST_FIELDS: ReadonlySet<string> = new Set([
  "costUsd",
  "fixCostUsd",
  "outsideCardsUsd",
]);

/** The field names of the interfaces `names` in `source` that say money (and are not the agents' cost). */
export function moneyFieldsIn(source: string, names: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    const body =
      new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
    for (const field of body.matchAll(/^\s{2}(\w+)\??:/gm)) {
      const key = field[1] as string;
      if (!COST_FIELDS.has(key) && FIELD_WORDS.test(key)) found.push(key);
    }
  }
  return found;
}
