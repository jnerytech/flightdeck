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

const FAMILIES = "opus|sonnet|haiku|fable";
const VERSIONED = new RegExp(String.raw`^claude-(${FAMILIES})-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$`);
const ALIAS = new RegExp(`^(${FAMILIES})$`);
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** `opus[1m]` is `opus`: a trailing `[…]` with no `]` inside; the `[` is the first one after the last `]` before it. */
function withoutContextSize(model: string): string {
  const close = model.length - 1;
  if (model[close] !== "]") return model;
  const start = model.indexOf("[", model.lastIndexOf("]", close - 1) + 1);
  return start === -1 ? model : model.slice(0, start);
}

/** A model as a person reads it ("Opus 5.5"); null for none. */
export function modelName(model: string | null | undefined): string | null {
  if (!model) return null;
  // "[1m]" and the like select a context size, not another model.
  const id = withoutContextSize(model);
  const versioned = VERSIONED.exec(id);
  if (versioned) {
    const [, family = "", major = "", minor] = versioned;
    const version = minor ? `${major}.${minor}` : major;
    return `${capital(family)} ${version}`;
  }
  return ALIAS.test(id) ? capital(id) : model;
}

/** Whether the menu row `value` is the model in use (an alias covers every version of its family). */
export function isCurrentModel(value: string, current: string): boolean {
  if (value === current) return true;
  return MAIN_MODELS.includes(value) && current.startsWith(`claude-${value}-`);
}
