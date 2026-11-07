import type { Card, ContractOverrides } from "@flightdeck/protocol";
import { type ReactNode, useState } from "react";
import { ContractDialog } from "@/components/board/contract-dialog";
import { useT } from "@/i18n/context";
import { type Lacking, startNeeds } from "../lib/board-contracts.ts";

/**
 * The question before a card starts (issue #78, slice 3a): a card with no acceptance criteria asks
 * first, and Start anyway goes on. `ask` runs `go` straight away when there is nothing to ask;
 * `dialog` is what the screen renders. `restoreFocus` names where the focus goes when the control
 * that started it is gone (a menu item).
 */
export function useStartAsk(restoreFocus?: (cardId: string) => void): {
  ask(card: Card, contracts: ContractOverrides, go: () => void): void;
  dialog: ReactNode;
} {
  const t = useT();
  const [pending, setPending] = useState<{ lacking: Lacking; go(): void } | null>(null);
  const ask = (card: Card, contracts: ContractOverrides, go: () => void) => {
    const needs = startNeeds(card, contracts);
    if (needs.length === 0) go();
    else setPending({ lacking: { card, needs }, go });
  };
  const dialog = pending ? (
    <ContractDialog
      t={t}
      start
      column=""
      lacking={[pending.lacking]}
      qualifying={0}
      onCancel={() => setPending(null)}
      onMoveAll={() => {
        const { go } = pending;
        setPending(null);
        go();
      }}
      {...(restoreFocus ? { onRestoreFocus: restoreFocus } : {})}
    />
  ) : null;
  return { ask, dialog };
}
