/**
 * Whether a model takes an effort. `model` is an alias of `MODELS` or "" (the persona's model);
 * `personaModel` is the persona's own model, a full id such as `claude-opus-5-5`, or null for none.
 */
export function takesEffort(model: string, personaModel: string | null): boolean {
  // A model of a family this list does not know, or none, is Claude Code's own: it takes one.
  return !/haiku/i.test(model || personaModel || "");
}
