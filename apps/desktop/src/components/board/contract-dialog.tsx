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
import type { T } from "../../i18n/index.ts";
import type { Lacking } from "../../lib/board-contracts.ts";
import { needsText } from "./needs-badge.tsx";

/**
 * The one question before a person's move to a column that asks for something (issue #78): who
 * lacks what, and a way to go on anyway. With several cards, the ones that have it all can go alone.
 */
export function ContractDialog(
  props: Readonly<{
    t: T;
    /** The column's name, as the board shows it. */
    column: string;
    lacking: readonly Lacking[];
    /** How many of the cards being moved have everything the column asks. */
    qualifying: number;
    onCancel(): void;
    onMoveAll(): void;
    /** Left out when there is nothing to split (a start asks about one card). */
    onMoveQualifying?(): void;
    /**
     * The dialog closed: the card it asked about gets the focus, the menu it came from is gone.
     * Left out, the focus goes back to the control that opened it.
     */
    onRestoreFocus?: (cardId: string) => void;
    /** The question is about starting the card, not moving it (issue #78, slice 3a). */
    start?: boolean;
  }>,
) {
  const { t, lacking } = props;
  const [first] = lacking;
  /** An action closes the dialog too: that close is not a cancel. */
  const acted = useRef(false);
  const act = (action: () => void) => () => {
    acted.current = true;
    action();
  };
  return (
    <AlertDialog open onOpenChange={(open) => !open && !acted.current && props.onCancel()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!props.onRestoreFocus) return;
          event.preventDefault();
          if (first) props.onRestoreFocus(first.card.id);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.start && first
              ? t("board.contract.startTitle", { title: first.card.title })
              : t("board.contract.title", { column: props.column })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-left">
              {lacking.length === 1 && first ? (
                <p>
                  {t("board.contract.lacksOne", {
                    title: first.card.title,
                    needs: needsText(t, first.needs),
                  })}
                </p>
              ) : (
                <>
                  <p>
                    {t("board.contract.lacksMany", {
                      count: lacking.length,
                      column: props.column,
                    })}
                  </p>
                  <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-left">
                    {lacking.map(({ card, needs }) => (
                      <li key={card.id}>
                        {t("board.contract.item", {
                          title: card.title,
                          needs: needsText(t, needs),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          {props.onMoveQualifying && props.qualifying > 0 && (
            <AlertDialogAction variant="outline" onClick={act(props.onMoveQualifying)}>
              {t("board.contract.moveQualifying")}
            </AlertDialogAction>
          )}
          <AlertDialogAction onClick={act(props.onMoveAll)}>
            {t(props.start ? "board.contract.startAnyway" : "board.contract.moveAnyway")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
