import { createContext, type ReactNode, useContext, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What a form is laid out for: a page, a dialog's body, or a bordered panel inside a screen. */
export type FormVariant = "page" | "dialog" | "panel";

/** The ids and ARIA a control of a `Field` takes. */
export interface FieldControl {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

// The one scale every form uses: 16 px between fields, 4 px between a label and its control, and
// 8 px between buttons. Forms do not set their own gaps.
const WIDTH: Record<FormVariant, string> = {
  page: "w-full max-w-xl",
  dialog: "w-full",
  panel: "w-full rounded-lg border bg-card p-4",
};

const VariantContext = createContext<FormVariant>("page");

/**
 * The shared form: a real `<form>`, so Enter in a text field submits it (Enter in a textarea adds
 * a line). Fields stack with labels above, and the buttons close it, primary last.
 */
export function Form(props: {
  onSubmit(): void;
  variant?: FormVariant;
  className?: string;
  /** Names the form for assistive technology when the screen has more than one. */
  "aria-label"?: string;
  children: ReactNode;
}) {
  const variant = props.variant ?? "page";
  return (
    <VariantContext.Provider value={variant}>
      <form
        data-variant={variant}
        aria-label={props["aria-label"]}
        className={cn("flex flex-col gap-4", WIDTH[variant], props.className)}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        {props.children}
      </form>
    </VariantContext.Provider>
  );
}

/** A label above its control, with optional help text and an error linked to the control. */
export function Field(props: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const helpId = props.help ? `${id}-help` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const described = [helpId, errorId].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id}>{props.label}</label>
      {props.children({
        id,
        ...(described ? { "aria-describedby": described } : {}),
        ...(props.error ? { "aria-invalid": true as const } : {}),
      })}
      {props.help && (
        <p id={helpId} className="text-muted-foreground text-xs">
          {props.help}
        </p>
      )}
      {props.error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {props.error}
        </p>
      )}
    </div>
  );
}

/**
 * The buttons that close a form: the secondary one first and the primary last, at the end of a
 * dialog and at the left edge of the fields elsewhere. A disabled primary says why under them.
 */
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
  const variant = useContext(VariantContext);
  const id = useId();
  const reason = props.disabled && props.disabledReason ? props.disabledReason : null;
  return (
    <div className="flex flex-col gap-2">
      <div
        data-actions
        className={cn(
          "flex flex-wrap items-center gap-2",
          variant === "dialog" ? "justify-end" : "justify-start",
        )}
      >
        {props.onCancel && (
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {props.cancel}
          </Button>
        )}
        <Button
          type="submit"
          disabled={props.disabled}
          {...(reason ? { "aria-describedby": id } : {})}
        >
          {props.submit}
        </Button>
      </div>
      {reason && (
        <p
          id={id}
          className={cn(
            "text-muted-foreground text-xs",
            variant === "dialog" ? "text-right" : "text-left",
          )}
        >
          {reason}
        </p>
      )}
    </div>
  );
}
