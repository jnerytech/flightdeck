/** A refusal's values as a stored row keeps them (#4083): the key and a JSON object of what its text fills in. */
import { z } from "zod";
import { parseJsonOr } from "../../kernel/index.ts";

type Params = Record<string, string | number>;

const ReasonParams = z.record(z.string(), z.union([z.string(), z.number()]));

/** The stored JSON of a refusal's values; null when there are none. */
export const paramsJson = (params: Params | null | undefined): string | null =>
  params ? JSON.stringify(params) : null;

/** The values a stored JSON holds; null when there are none or the text is damaged. */
export const paramsOf = (json: string | null): Params | null =>
  json === null ? null : parseJsonOr(ReasonParams, json, null);

const MAX_PARAMS = 4;
const MAX_PARAM_TEXT = 200;

/**
 * A reason another host sends back (#4083): its key counts only inside the messaging namespace and its
 * values stay few and short, so a host cannot make the app say a sentence of another feature. Anything
 * else is dropped, and the app falls back to the plain reason.
 */
export function relayedWhy(
  key: string | null | undefined,
  params: Params | null | undefined,
): { key: string | null; params: Params | null } {
  if (!key || !/^messaging_[a-z_]{1,60}$/.test(key)) return { key: null, params: null };
  const entries = Object.entries(params ?? {});
  const plain =
    entries.length <= MAX_PARAMS &&
    entries.every(([, v]) => typeof v === "number" || v.length <= MAX_PARAM_TEXT);
  return { key, params: plain && entries.length > 0 ? Object.fromEntries(entries) : null };
}
