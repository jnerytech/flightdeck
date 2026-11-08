import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Key, T } from "../../i18n/index.ts";
import type { Need } from "../../lib/board-contracts.ts";

/** What a card lacks, in words: "a PR link, passing checks". */
export const needsText = (t: T, needs: readonly Need[]) =>
  needs.map((need) => t(`board.contract.needs.${need}` as Key)).join(", ");

/** The mark a card wears while it lacks what its column asks: words and an icon, not only colour. */
export function NeedsBadge(
  props: Readonly<{
    t: T;
    needs: readonly Need[];
    /** Goes where the card is fixed (#1197): a button when given, plain words when not. */
    onFix?: () => void;
  }>,
) {
  const content = (
    <>
      <CircleAlert aria-hidden="true" />
      {props.t("board.contract.hint", { needs: needsText(props.t, props.needs) })}
    </>
  );
  // Several needs make a long sentence: it wraps inside the tile instead of being cut at its edge.
  const wrap = "text-status-needs-you max-w-full whitespace-normal text-left";
  if (!props.onFix) {
    return (
      <Badge variant="outline" className={wrap}>
        {content}
      </Badge>
    );
  }
  return (
    <Badge asChild variant="outline" className={wrap}>
      <button
        type="button"
        // Not a Tab stop: a column is one (#1198); Enter on the card's title opens the same card.
        tabIndex={-1}
        // The tile is already accent while hovered, so the cue is an underline.
        className="cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(e) => {
          // A modified click selects the card (the tile handles it); only a plain one goes to the fix.
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) props.onFix?.();
        }}
      >
        {content}
      </button>
    </Badge>
  );
}
