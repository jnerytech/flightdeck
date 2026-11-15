import type { SshImportResult } from "@flightdeck/protocol";
import type { FlightdeckError } from "../../kernel/index.ts";

/** Why one alias was not imported: the English text, and a key with values for the app. */
export type Skip = Omit<SshImportResult["skipped"][number], "alias">;

/** The skip a refused `targets.save` turns into: its message and, when it has them, reason and params. */
export function skipOf(error: unknown): Skip {
  const refusal = error as Partial<FlightdeckError> & Error;
  return {
    reason: refusal.message,
    ...(refusal.reason ? { why: refusal.reason } : {}),
    ...(refusal.params ? { params: refusal.params } : {}),
  };
}
