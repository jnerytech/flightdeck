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
import type { T } from "@/i18n/index";

/**
 * #1133, slice A2: End on a session whose checkout has files it did not commit. Commit… goes to
 * its Changes, End anyway ends it with the files left where they are, Cancel keeps it running.
 */
export function EndWithChangesDialog(
  props: Readonly<{
    t: T;
    /** How many files are not committed. */
    files: number;
    onCommit(): void;
    onEnd(): void;
    onCancel(): void;
  }>,
) {
  const { t } = props;
  const commit = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Radix focuses Cancel; the answer that loses nothing and moves on is Commit….
          event.preventDefault();
          commit.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t("session.endChangesTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {props.files === 1
              ? t("session.endChangesOne")
              : t("session.endChangesMany", { n: props.files })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onEnd}>
            {t("session.endAnyway")}
          </AlertDialogAction>
          <AlertDialogAction ref={commit} onClick={props.onCommit}>
            {t("session.endCommitFirst")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
