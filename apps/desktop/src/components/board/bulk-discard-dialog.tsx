import type { Card } from "@flightdeck/protocol";
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

/** A card that has a worktree, a branch or a session has work to clean up. */
export const hasStartedWork = (card: Card) =>
  Boolean(card.worktreePath || card.branch || card.sessionId);

/** One confirmation for discarding many cards: each is listed, with what goes with it. */
export function BulkDiscardDialog(props: {
  cards: Card[];
  t: T;
  onCancel(): void;
  onConfirm(): void;
}) {
  const { t, cards } = props;
  const n = cards.length;
  return (
    <AlertDialog open onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {n === 1 ? t("board.discardOneTitle") : t("board.discardManyTitle", { n })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-left">
              {cards.map((card) => (
                <li key={card.id}>
                  {card.title}
                  {hasStartedWork(card) && (
                    <span className="text-muted-foreground">{` — ${t("board.discardStarted")}`}</span>
                  )}
                </li>
              ))}
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>
            {n === 1 ? t("board.discardOneConfirm") : t("board.discardManyConfirm", { n })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
