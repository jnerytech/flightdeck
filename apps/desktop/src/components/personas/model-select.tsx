import { Field, NativeSelect } from "@/components/layout/form";

/** The model aliases a session can open in or switch to. */
export const MODELS = ["opus", "sonnet", "haiku"] as const;

/** A choice of model; "" is the default, named by `defaultLabel`. */
export function ModelSelect(props: {
  label: string;
  defaultLabel: string;
  value: string;
  onChange(value: string): void;
}) {
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
