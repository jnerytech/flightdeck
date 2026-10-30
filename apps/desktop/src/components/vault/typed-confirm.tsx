import { useRef, useState } from "react";
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
import { useT } from "@/i18n/context";

/** A confirmation that only opens its button once the person has typed `word` (case aside). */
export function TypedConfirm(props: {
  message: string;
  /** The word to type: "revelar", or the name of what is being removed. */
  word: string;
  inputLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  // The action closes the dialog too: only a close that was not a confirmation is a cancel.
  const confirmed = useRef(false);
  const matches = typed.trim().toLowerCase() === props.word.toLowerCase();
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmed.current) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.confirmLabel}</AlertDialogTitle>
          <AlertDialogDescription>{props.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          aria-label={props.inputLabel}
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
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
