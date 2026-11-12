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
  return model === "" && personaModel === null;
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
