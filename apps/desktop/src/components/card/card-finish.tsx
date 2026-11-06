import type { Card } from "@flightdeck/protocol";
import { ActionButton } from "@/components/feedback/action-button";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

/**
 * Finish… (journey J5, issue #188): the three ways a card ends, each with what it does: move it to
 * Done, complete it (asks first), or merge its work (from the diff, while the card has no PR).
 */
export function CardFinishDialog(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    card: Card;
    onClose(): void;
    /** Complete was chosen: the caller asks to confirm. */
    onComplete(): void;
    /** Merge was chosen: the caller shows the card's diff, where the merge is. */
    onMerge(): void;
  }>,
) {
  const t = useT();
  const { store, hostId, card } = props;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("cardUi.finishTitle")}</DialogTitle>
        </DialogHeader>
        <Stack as="ul" gap={4} label={t("cardUi.finishTitle")}>
          <li>
            <Stack gap={1}>
              <span>{t("cardUi.finishMove")}</span>
              <ActionButton
                variant="outline"
                disabled={card.column === "done"}
                disabledReason={t("cardUi.alreadyDone")}
                onClick={async () => {
                  props.onClose();
                  await store.hostCommand(hostId, "card.move", { cardId: card.id, column: "done" });
                }}
              >
                {t("cardUi.finishMoveButton")}
              </ActionButton>
            </Stack>
          </li>
          <li>
            <Stack gap={1}>
              <span>{t("cardUi.finishComplete")}</span>
              <Button
                variant="outline"
                onClick={() => {
                  props.onClose();
                  props.onComplete();
                }}
              >
                {t("cardUi.complete")}
              </Button>
            </Stack>
          </li>
          <li>
            <Stack gap={1}>
              <span>{t("cardUi.finishMerge")}</span>
              <ActionButton
                variant="outline"
                disabled={!card.worktreePath || Boolean(card.prUrl)}
                disabledReason={t(card.prUrl ? "cardUi.finishHasPr" : "cardUi.finishNeedWorktree")}
                onClick={() => {
                  props.onClose();
                  props.onMerge();
                }}
              >
                {t("cardUi.finishMergeButton")}
              </ActionButton>
            </Stack>
          </li>
        </Stack>
      </AppDialogContent>
    </Dialog>
  );
}
