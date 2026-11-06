import type { EffortLevel } from "@flightdeck/protocol";

/** How hard the model works, from the lightest. */
export const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** The models the menu lists first: the aliases, which always mean the latest of the family. */
export const MAIN_MODELS: readonly string[] = ["opus", "sonnet", "haiku"];

/** The models under "More models": a specific version each. */
export const MORE_MODELS: readonly string[] = [
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
];

/** A model as a person reads it ("Opus 5.5"); null for none. */
export function modelName(_model: string | null | undefined): string | null {
  return "";
}

/** Whether the menu row `value` is the model in use (an alias covers every version of its family). */
export function isCurrentModel(_value: string, _current: string): boolean {
  return false;
}
