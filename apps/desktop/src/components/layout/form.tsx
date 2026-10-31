import type { ReactNode } from "react";

/** What a form is laid out for: a page, a dialog's body, or a bordered panel inside a screen. */
export type FormVariant = "page" | "dialog" | "panel";

/** The ids and ARIA a control of a `Field` takes. */
export interface FieldControl {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export function Form(props: {
  onSubmit(): void;
  variant?: FormVariant;
  className?: string;
  children: ReactNode;
}) {
  return <div>{props.children}</div>;
}

export function Field(props: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}) {
  return <div>{props.children({ id: "" })}</div>;
}

export function FormActions(props: {
  /** The primary button's label: the verb of what the form does. */
  submit: string;
  disabled?: boolean;
  /** Why the primary button is disabled: shown under the buttons, never silent. */
  disabledReason?: ReactNode;
  /** The secondary button's label; the button only exists with `onCancel`. */
  cancel?: string;
  onCancel?(): void;
}) {
  void props;
  return null;
}
