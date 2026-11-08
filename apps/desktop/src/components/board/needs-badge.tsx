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
  if (!props.onFix) {
    return (
      <Badge variant="outline" className="text-status-needs-you">
        {content}
      </Badge>
    );
  }
  return (
    <Badge asChild variant="outline" className="text-status-needs-you">
      <button
        type="button"
        className="cursor-pointer hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        onClick={props.onFix}
      >
        {content}
      </button>
    </Badge>
  );
}
