import { type ReactNode, type Ref, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./form.tsx";
import { Inline } from "./stack.tsx";

/**
 * A `Field` over a password `Input` the browser does not fill in: the label, the help and the value in one place.
 * With `reveal` a button beside it shows the text typed, and its name flips with the state (#4402); the field is
 * hidden each time the field is mounted again, and the text is never kept anywhere else.
 */
export function PasswordField(
  props: Readonly<{
    label: ReactNode;
    help?: ReactNode;
    value: string;
    onChange: (value: string) => void;
    inputRef?: Ref<HTMLInputElement>;
    /** The names of the control when the text is hidden (Show…) and when it is shown (Hide…). */
    reveal?: Readonly<{ show: string; hide: string }>;
  }>,
) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={props.label} help={props.help}>
      {(control) => {
        const input = (
          <Input
            {...control}
            ref={props.inputRef}
            type={shown ? "text" : "password"}
            autoComplete="off"
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
          />
        );
        if (!props.reveal) return input;
        return (
          <Inline gap={1}>
            {input}
            <Button type="button" variant="ghost" size="sm" onClick={() => setShown((now) => !now)}>
              {shown ? props.reveal.hide : props.reveal.show}
            </Button>
          </Inline>
        );
      }}
    </Field>
  );
}
