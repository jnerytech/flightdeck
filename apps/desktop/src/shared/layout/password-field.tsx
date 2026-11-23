import type { ReactNode, Ref } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "./form.tsx";

/** A `Field` over a password `Input` the browser does not fill in: the label, the help and the value in one place. */
export function PasswordField(
  props: Readonly<{
    label: ReactNode;
    help?: ReactNode;
    value: string;
    onChange: (value: string) => void;
    inputRef?: Ref<HTMLInputElement>;
  }>,
) {
  return (
    <Field label={props.label} help={props.help}>
      {(control) => (
        <Input
          {...control}
          ref={props.inputRef}
          type="password"
          autoComplete="off"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
