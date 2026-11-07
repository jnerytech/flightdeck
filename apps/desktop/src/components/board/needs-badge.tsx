import { CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Key, T } from "../../i18n/index.ts";
import type { Need } from "../../lib/board-contracts.ts";

/** What a card lacks, in words: "a PR link, passing checks". */
export const needsText = (t: T, needs: readonly Need[]) =>
  needs.map((need) => t(`board.contract.needs.${need}` as Key)).join(", ");

/** The mark a card wears while it lacks what its column asks: words and an icon, not only colour. */
export function NeedsBadge(props: Readonly<{ t: T; needs: readonly Need[] }>) {
  return (
    <Badge variant="outline" className="text-status-needs-you">
      <CircleAlert aria-hidden="true" />
      {props.t("board.contract.hint", { needs: needsText(props.t, props.needs) })}
    </Badge>
  );
}
