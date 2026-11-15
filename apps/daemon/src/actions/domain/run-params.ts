import { FlightdeckError } from "../../kernel/index.ts";
import { type ActionDef, paramRegex } from "./schema.ts";

const bad = (message: string, reason?: string, params?: Record<string, string | number>) =>
  new FlightdeckError("bad_request", message, reason, params);

/** The values of every parameter: those given, else the default; each matching its whole pattern. */
export function resolveParams(
  action: ActionDef,
  given: Record<string, string>,
): Record<string, string> {
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(action.params, key))
      throw bad(`unknown parameter: ${key}`, "action_param_unknown", { param: key });
  }
  const values: Record<string, string> = {};
  for (const [key, spec] of Object.entries(action.params)) {
    const value = given[key] ?? spec.default;
    if (value === undefined)
      throw bad(`missing parameter ${key}`, "action_param_missing", { param: key });
    if (!paramRegex(spec.pattern).test(value)) {
      throw bad(
        `parameter ${key} does not match the pattern ${spec.pattern}`,
        "action_param_pattern",
        {
          param: key,
          pattern: spec.pattern,
        },
      );
    }
    values[key] = value;
  }
  return values;
}
