import type { Card } from "@flightdeck/protocol";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import type { T } from "../../i18n/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { discardCommand, hasStartedWork } from "./bulk-discard-dialog.tsx";

/**
 * The confirmation behind a card's Delete…. A card that has a worktree, a branch or a session has work
 * to clean up, so it is discarded, not deleted: the dialog says so and the confirm goes through the
 * existing discard.
 */
export function DeleteCardDialog(
  props: Readonly<{ t: T; store: AppStore; hostId: string; card: Card; onClose(): void }>,
) {
  const { t, card } = props;
  const started = hasStartedWork(card);
  return (
    <ConfirmDialog
      message={
        started
          ? t("board.deleteStarted", { title: card.title })
          : t("board.deleteMessage", { title: card.title })
      }
      confirmLabel={started ? t("board.discardInstead") : t("board.deleteConfirm")}
      destructive
      onCancel={props.onClose}
      onConfirm={() => {
        props.onClose();
        void props.store.hostCommand(props.hostId, discardCommand(card), {
          cardId: card.id,
          confirm: true,
        });
      }}
    />
  );
}
