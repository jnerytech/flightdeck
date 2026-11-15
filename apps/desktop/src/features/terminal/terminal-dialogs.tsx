import { useRef } from "react";
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
 * The OK before a paste of several lines (#476): the program has not turned on bracketed paste, so
 * each line may run as a command as soon as it lands. Cancel has the focus: it is the safe answer.
 */
export function TerminalPasteDialog(
  props: Readonly<{ lines: number; onAnswer(ok: boolean): void }>,
) {
  const t = useT();
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onAnswer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("terminalUi.pasteTitle", { n: String(props.lines) })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("terminalUi.pasteMessage")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => props.onAnswer(true)}>
            {t("terminalUi.pasteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TerminalCloseDialog(props: Readonly<{ onClose(kill: boolean | null): void }>) {
  const t = useT();
  const detach = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onClose(null)}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Radix focuses Cancel; the safe answer here is Detach, never End.
          event.preventDefault();
          detach.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("terminalUi.close")}</AlertDialogTitle>
          <AlertDialogDescription>{t("terminalUi.closeMessage")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => props.onClose(true)}>
            {t("terminalUi.end")}
          </AlertDialogAction>
          <AlertDialogAction ref={detach} onClick={() => props.onClose(false)}>
            {t("terminalUi.detach")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
