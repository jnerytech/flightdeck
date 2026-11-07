import type { Card } from "@flightdeck/protocol";
import { useEffect } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";

/**
 * What the host found of the card's spec file (issue #78): looked at when the card opens and
 * again on Check again. The file's own first heading is shown as plain text; its contents never
 * reach the app.
 */
export function CardSpec(props: Readonly<{ store: AppStore; hostId: string; card: Card }>) {
  const t = useT();
  const { store, hostId, card } = props;
  // Quietly: a host that does not know the command (an older daemon) is not a problem to report.
  useEffect(() => {
    void store.hostRequest(hostId, "card.spec", { cardId: card.id });
  }, [store, hostId, card.id]);
  const state = card.specState;
  let said: string | null = null;
  if (state?.found) {
    said = state.heading
      ? t("cardUi.specFound", { heading: state.heading })
      : t("cardUi.specFoundPlain");
  } else if (state) {
    said = t("cardUi.specMissing", { path: state.path });
  } else if (!card.worktreePath) {
    said = t("cardUi.specNoWorktree");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <output className="text-muted-foreground text-sm" aria-live="polite">
        {said}
      </output>
      <ActionButton
        variant="outline"
        onClick={() => store.hostCommand(hostId, "card.spec", { cardId: card.id })}
      >
        {t("cardUi.specCheck")}
      </ActionButton>
    </div>
  );
}
