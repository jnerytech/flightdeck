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
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";

/**
 * Issue #502: the session is live in another terminal. Opening it again starts a second `claude`
 * that the other one does not see, so the default is to follow it here, read-only; a second copy
 * only on purpose.
 */
export function LiveElsewhereDialog(
  props: Readonly<{ onView(): void; onAnyway(): void; onCancel(): void }>,
) {
  const t = useT();
  // Either choice closes the dialog too: only a close that was not a choice is a cancel.
  const chosen = useRef(false);
  const choose = (then: () => void) => () => {
    chosen.current = true;
    then();
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !chosen.current) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("liveElsewhere.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("liveElsewhere.message")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="outline" onClick={choose(props.onAnyway)}>
            {t("liveElsewhere.anyway")}
          </Button>
          <AlertDialogAction onClick={choose(props.onView)}>
            {t("liveElsewhere.view")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
