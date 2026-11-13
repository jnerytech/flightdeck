import { useId, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/context";

/** A confirmation that only opens its button once the person has typed `word` (case aside). */
export function TypedConfirm(
  props: Readonly<{
    message: string;
    /** The word to type: "revelar", or the name of what is being removed. */
    word: string;
    inputLabel: string;
    confirmLabel: string;
    destructive?: boolean;
    /** Where the focus goes when the dialog closes (the button that opened it), if it is still on the page. */
    returnFocus?(): HTMLElement | null;
    onConfirm(): void;
    onCancel(): void;
  }>,
) {
  const t = useT();
  const [typed, setTyped] = useState("");
  // The action closes the dialog too: only a close that was not a confirmation is a cancel.
  const confirmed = useRef(false);
  const action = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const matches = typed.trim().toLowerCase() === props.word.toLowerCase();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmed.current) props.onCancel();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          const back = props.returnFocus?.();
          if (back?.isConnected) {
            event.preventDefault();
            back.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{props.confirmLabel}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <Label htmlFor={inputId}>{props.inputLabel}</Label>
        <Input
          id={inputId}
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            // The same way out as the button, so the dialog closes like it does.
            if (event.key === "Enter" && matches) {
              event.preventDefault();
              action.current?.click();
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            ref={action}
            variant={props.destructive ? "destructive" : "default"}
            disabled={!matches}
            onClick={() => {
              confirmed.current = true;
              props.onConfirm();
            }}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
