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
import type { T } from "../../i18n/index.ts";

/** One card of the confirm's list: a card the action skips is dimmed, with why. */
export interface BulkRunItem {
  id: string;
  title: string;
  skipped?: string;
}

/**
 * #1354: the question before Start N or Stop N runs on a selection. The lines say what will happen
 * (the host's queue and quota, where stopped cards land); the list names every selected card, the
 * skipped ones dimmed with their reason. Nothing is destructive: worktrees and branches stay.
 */
export function BulkRunDialog(
  props: Readonly<{
    t: T;
    title: string;
    lines: string[];
    items: BulkRunItem[];
    confirmLabel: string;
    onCancel(): void;
    onConfirm(): void;
  }>,
) {
  const { t } = props;
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-left">
              {props.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-left">
                {props.items.map((item) => (
                  <li key={item.id} className={item.skipped ? "text-muted-foreground" : undefined}>
                    {item.title}
                    {item.skipped && (
                      <span>{` — ${t("board.skipped", { reason: item.skipped })}`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
