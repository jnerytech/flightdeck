import type { EffortLevel } from "@flightdeck/protocol";
import { Field, NativeSelect } from "@/shared/layout/index.ts";

/** The model aliases a session can open in or switch to. */
export const MODELS = ["opus", "sonnet", "haiku"] as const;

/** How hard the model works, from the lightest. */
export const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * Whether a model takes an effort. `model` is an alias of `MODELS` or "" (the persona's model);
 * `personaModel` is the persona's own model, a full id such as `claude-opus-5-5`, or null for none.
 */
export function takesEffort(model: string, personaModel: string | null): boolean {
  // A model of a family this list does not know, or none, is Claude Code's own: it takes one.
  return !/haiku/i.test(model || personaModel || "");
}

/** A choice of model; "" is the default, named by `defaultLabel`. */
export function ModelSelect(
  props: Readonly<{
    label: string;
    defaultLabel: string;
    value: string;
    onChange(value: string): void;
  }>,
) {
  return (
    <Field label={props.label}>
      {(control) => (
        <NativeSelect
          {...control}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        >
          <option value="">{props.defaultLabel}</option>
          {MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}

/** A choice of effort; "" is the default, named by `defaultLabel`. */
export function EffortSelect(
  props: Readonly<{
    label: string;
    defaultLabel: string;
    value: EffortLevel | "";
    onChange(value: EffortLevel | ""): void;
  }>,
) {
  return (
    <Field label={props.label}>
      {(control) => (
        <NativeSelect
          {...control}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value as EffortLevel | "")}
        >
          <option value="">{props.defaultLabel}</option>
          {EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
