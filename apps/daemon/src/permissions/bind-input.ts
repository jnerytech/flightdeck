import type { ToolInput } from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";
import { canonical } from "./permission-updates.ts";

const changed = () =>
  new FlightdeckError(
    "invalid_state",
    "the answer changes what the request runs: an approval is for the input that was asked",
    "input_changed",
  );

/** The input without its `answers`: what an AskUserQuestion asked. */
const asked = (input: ToolInput) => {
  const { answers: _answers, ...rest } = input;
  return rest;
};

/**
 * An allow is for the input that was asked: the risk was judged on it and the person looked at it.
 * `updatedInput` must be that same input (keys in any order). The one exception is a question,
 * which takes its `answers` (strings) and nothing else (issue #384).
 */
export function bindInput(
  toolName: string,
  original: ToolInput,
  updated: ToolInput | undefined,
): void {
  if (updated === undefined) return;
  if (toolName !== "AskUserQuestion") {
    if (canonical(updated) !== canonical(original)) throw changed();
    return;
  }
  const answers = updated.answers;
  const text =
    answers === undefined ||
    (typeof answers === "object" &&
      answers !== null &&
      !Array.isArray(answers) &&
      Object.values(answers).every((value) => typeof value === "string"));
  if (!text || canonical(asked(updated)) !== canonical(asked(original))) throw changed();
}
