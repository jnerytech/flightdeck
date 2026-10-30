import {
  normalizeSnippet as normalize,
  renderSnippet as render,
  type SecretScanner,
  type SnippetContext,
  type SnippetDef,
  type SnippetInput,
  SnippetModelError,
} from "@flightdeck/protocol";
import { FlightdeckError } from "../errors.ts";

export {
  fieldsOf,
  hasControl,
  placeholders,
  SecretScanner,
  type SnippetContext,
  type SnippetDef,
  SPECIAL_VARS,
} from "@flightdeck/protocol";

/** The model's refusals as protocol errors, with their code (`bad_request`, `snippet_secret`). */
function asProtocolError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SnippetModelError) throw new FlightdeckError(error.code, error.message);
    throw error;
  }
}

/** See the shared model: one line for a command, no secret, variables used and well formed. */
export const normalizeSnippet = (input: SnippetInput, scanner: SecretScanner): SnippetDef =>
  asProtocolError(() => normalize(input, scanner));

/** See the shared model: fills the template from the values, the defaults and the context. */
export const renderSnippet = (
  def: SnippetDef,
  values: Record<string, string>,
  context: SnippetContext,
): string => asProtocolError(() => render(def, values, context));
