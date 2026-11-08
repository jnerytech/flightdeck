import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { Spinner } from "@/components/feedback/busy";
import { Button } from "@/components/ui/button";
import { useInFlight } from "@/hooks/use-in-flight";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";

/** What a form is laid out for: a page, a dialog's body, a bordered panel, or a part of a panel. */
export type FormVariant = "page" | "dialog" | "panel" | "inline";

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
  panel: "w-full max-w-2xl rounded-lg border bg-card p-4",
  inline: "w-full",
};

const VariantContext = createContext<FormVariant>("page");

/**
 * The shared form: a real `<form>`, so Enter in a text field submits it (Enter in a textarea adds
 * a line). Fields stack with labels above, and the buttons close it, primary last.
 */
export function Form(
  props: Readonly<{
    onSubmit(): void;
    variant?: FormVariant;
    className?: string;
    /** Names the form for assistive technology when the screen has more than one. */
    "aria-label"?: string;
    children: ReactNode;
  }>,
) {
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
export function Field(
  props: Readonly<{
    label: ReactNode;
    help?: ReactNode;
    error?: ReactNode;
    /** For the field's box in a row: `min-w-0 flex-1` lets a text field take the row's room. */
    className?: string;
    children: (control: FieldControl) => ReactNode;
  }>,
) {
  const id = useId();
  const helpId = props.help ? `${id}-help` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const described = [helpId, errorId].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1 text-sm", props.className)}>
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
 * The native `<select>` every form uses, sized like an `Input`: it takes a `Field`'s control props.
 * `inline` sizes it to its options instead of the row, for a toolbar; `compact` is the toolbar's
 * smaller height and text.
 */
export function NativeSelect({
  className,
  inline,
  compact,
  ...props
}: ComponentProps<"select"> & { inline?: boolean; compact?: boolean }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "rounded-md border border-input bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "h-8 text-xs" : "h-9 text-sm",
        inline ? "w-auto" : "w-full",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The buttons that close a form: the secondary one first and the primary last, at the end of a
 * dialog and at the left edge of the fields elsewhere. A disabled primary says why under them.
 */
export function FormActions(
  props: Readonly<{
    /** The primary button's label: the verb of what the form does. */
    submit: string;
    disabled?: boolean;
    /** The form is working (a command is running): the primary shows a spinner and does nothing. */
    busy?: boolean;
    /** Why the primary button is disabled: shown under the buttons, never silent. */
    disabledReason?: ReactNode;
    /** The secondary button's label; the button only exists with `onCancel`. */
    cancel?: string;
    onCancel?(): void;
    /** The buttons stay at the bottom of the page's scroller while the fields scroll under them. */
    sticky?: boolean;
    /** More secondary buttons (a wizard's "Voltar"), after the cancel and before the primary. */
    extra?: ReactNode;
  }>,
) {
  const variant = useContext(VariantContext);
  const id = useId();
  const stage = useInFlight(Boolean(props.busy));
  const t = useT();
  const reason = props.disabled && props.disabledReason ? props.disabledReason : null;
  return (
    <div
      {...(props.sticky ? { "data-sticky-actions": "" } : {})}
      className={cn("flex flex-col gap-2", props.sticky && "form-actions-sticky")}
    >
      <div
        data-actions
        data-slot="form-actions"
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
        {props.extra}
        <Button
          type="submit"
          disabled={props.disabled || props.busy}
          aria-busy={props.busy || undefined}
          data-feedback={props.busy ? stage : undefined}
          {...(reason ? { "aria-describedby": id } : {})}
        >
          {(stage === "spinner" || stage === "slow") && <Spinner />}
          {props.submit}
          {stage === "slow" && (
            <span data-stage className="font-normal text-xs opacity-80">
              {t("inFlight.stillWorking")}
            </span>
          )}
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

/** A checkbox with its label beside it, for a switch in a toolbar. */
export function CheckField(
  props: Readonly<{
    checked: boolean;
    onChange(checked: boolean): void;
    /** Shown but not changeable: what cannot be picked, with the reason beside it. */
    disabled?: boolean;
    /** The note that says why, read with the checkbox. */
    describedBy?: string;
    children: ReactNode;
  }>,
) {
  return (
    <label className="flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.children}
    </label>
  );
}

/**
 * A form row: fields and the buttons that act on them on one line, and under it the help line.
 * An ActionButton inside says why it is disabled there (aligned with the first field), not under
 * itself.
 */
export function FieldRow(
  props: Readonly<{
    children: ReactNode;
    className?: string;
    /** `end` lines the controls up by their bottom edges (fields with labels above them). */
    align?: "end";
    /** The row's `data-slot`, for a screen that names its part. */
    slot?: string;
  }>,
) {
  // One line per disabled button, in the order they said why (#732): two buttons off at
  // once each keep their own reason, and enabling one drops only its line.
  const [reasons, setReasons] = useState<ReadonlyArray<RowReason>>([]);
  const setReason = useCallback((id: string, text: string | null) => {
    setReasons((list) => withReason(list, id, text));
  }, []);
  const slot = useMemo(() => ({ setReason }), [setReason]);
  return (
    <FieldRowContext.Provider value={slot}>
      <div className="field-row-wrap">
        <div
          data-slot={props.slot}
          className={cn("field-row", props.align === "end" && "field-row-end", props.className)}
        >
          {props.children}
        </div>
        {reasons.map((reason) => (
          <p key={reason.id} id={reason.id} className="field-help">
            {reason.text}
          </p>
        ))}
      </div>
    </FieldRowContext.Provider>
  );
}

interface RowReason {
  id: string;
  text: string;
}

/**
 * The row's reasons with the one of `id` taken out and, when it has a text, put back at the end. A
 * button's changed reason comes as its old one taken out (the effect's cleanup), then the new one.
 */
function withReason(
  list: ReadonlyArray<RowReason>,
  id: string,
  text: string | null,
): ReadonlyArray<RowReason> {
  const rest = list.filter((reason) => reason.id !== id);
  return text === null ? rest : [...rest, { id, text }];
}

interface FieldRowSlot {
  /** Shows the reason of the button whose help line is `id`, or removes it with `null`. */
  setReason(id: string, reason: string | null): void;
}

/** What a button inside a `FieldRow` finds: where to say why it is disabled. */
const FieldRowContext = createContext<FieldRowSlot | null>(null);
export const useFieldRow = () => useContext(FieldRowContext);
