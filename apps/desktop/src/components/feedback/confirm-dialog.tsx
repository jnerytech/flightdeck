import { type ReactNode, useRef } from "react";
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
import { useT } from "@/i18n/context";

/**
 * In-app confirmation (never `window.confirm`, which blocks the webview): an AlertDialog with
 * focus trapped, Esc to cancel, and the confirming button named for what it does (red when it
 * cannot be undone).
 */
export function ConfirmDialog(
  props: Readonly<{
    message: string;
    warning?: string | null;
    /** The verb of the confirming button ("Remover host", "Encerrar sessão"…). */
    confirmLabel: string;
    /** The confirming button is red: what it does cannot be undone. */
    destructive?: boolean;
    /** What the person reads before confirming, below the message (lists, a choice). */
    children?: ReactNode;
    /** The confirming button is off: nothing to do yet, or a choice is still to be made. */
    confirmDisabled?: boolean;
    onConfirm(): void;
    onCancel(): void;
  }>,
) {
  const t = useT();
  // The action closes the dialog too: only a close that was not a confirmation is a cancel.
  const confirmed = useRef(false);
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
          {props.warning && <p className="text-sm text-status-needs-you">{props.warning}</p>}
        </AlertDialogHeader>
        {props.children}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={props.destructive ? "destructive" : "default"}
            disabled={props.confirmDisabled}
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
