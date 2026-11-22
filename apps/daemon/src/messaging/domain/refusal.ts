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
