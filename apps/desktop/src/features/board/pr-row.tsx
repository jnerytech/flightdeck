import type { WatchInfo } from "@flightdeck/protocol";
import { CircleAlert, CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import { canMergeCardPr } from "@/lib/card-merge-pr";
import { mergeStance, type PullRequestRow, prFacts } from "@/lib/pull-requests";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Inline, Stack } from "@/shared/layout/index.ts";

const CHECK_ICONS = { passing: CircleCheck, pending: CircleDashed, failing: CircleAlert } as const;

/** What the card's watch is doing, in words. */
function watchText(t: ReturnType<typeof useT>, watch: WatchInfo): string {
  if (watch.status === "needs_you") return t("watchUi.needsYou", { reason: watch.reason ?? "" });
  return watch.enabled ? t("watchUi.watching") : t("pullRequests.watchOff");
}

/**
 * One open PR: which card and where it lives, its checks and watch, and what can be done to it
 * from here. Merge asks first (the page holds the confirm); updating from the base shows the
 * host's refusal, which lists the files in conflict.
 */
export function PrRow(
  props: Readonly<{
    row: PullRequestRow;
    /** The time the ages are counted to (`store.now()`). */
    now: number;
    watch: WatchInfo | undefined;
    /** The host merges PRs (`cardPrMerge`). */
    canMerge: boolean;
    /** The host watches PRs (`watch`). */
    withWatch: boolean;
    onOpenCard(): void;
    onOpenPr(): void;
    onMerge(): void;
    onUpdate(): Promise<void>;
  }>,
) {
  const t = useT();
  // The controls are described by the title, so a list of buttons says which PR each is for.
  const titleId = useId();
  const { card } = props.row;
  const Checks = card.checksState ? CHECK_ICONS[card.checksState] : null;
  const stance = mergeStance(card);
  const facts = prFacts(card, props.now, t, stance.kind !== "conflict");
  const heldId = useId();
  const mergeable = props.canMerge && canMergeCardPr(card);
  const where = [props.row.hostName, props.row.projectName].filter(Boolean).join(" · ");
  return (
    <li data-slot="pr-row" className="rounded-md border px-3 py-2 text-sm">
      <Stack gap={2}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h2 id={titleId} className="font-medium">
              <button
                type="button"
                className="break-words text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={props.onOpenCard}
              >
                {card.title}
              </button>
            </h2>
            <p className="text-muted-foreground text-xs">{where}</p>
          </div>
          <Inline gap={2}>
            {Checks && card.checksState && (
              <Badge variant="outline">
                <Checks aria-hidden="true" />
                {t(`checks.${card.checksState}` as Key)}
              </Badge>
            )}
            {stance.kind === "conflict" && (
              <span data-slot="pr-conflict">
                <Badge variant="outline" className="text-status-needs-you">
                  <TriangleAlert aria-hidden="true" />
                  {t("pullRequests.conflict")}
                </Badge>
              </span>
            )}
            <a
              href={card.prUrl ?? undefined}
              className="text-sm underline"
              aria-describedby={titleId}
              onClick={(event) => {
                event.preventDefault();
                props.onOpenPr();
              }}
            >
              {t("cardMergePr.openPr")}
            </a>
          </Inline>
        </div>
        {facts.length > 0 && (
          <p data-slot="pr-facts" className="text-muted-foreground text-xs">
            {facts.join(" · ")}
          </p>
        )}
        {props.withWatch && props.watch && (
          <p className="text-muted-foreground text-xs">{watchText(t, props.watch)}</p>
        )}
        <Inline gap={2}>
          {mergeable && stance.kind !== "conflict" && (
            <ActionButton
              variant={stance.kind === "held" ? "outline" : "default"}
              size="sm"
              aria-describedby={stance.kind === "held" ? `${titleId} ${heldId}` : titleId}
              onClick={props.onMerge}
            >
              {t("cardMergePr.action")}
            </ActionButton>
          )}
          {card.worktreePath && (
            <ActionButton
              variant={stance.kind === "conflict" ? "default" : "outline"}
              size="sm"
              aria-describedby={titleId}
              onClick={props.onUpdate}
            >
              {t("cardReview.updateFromBase")}
            </ActionButton>
          )}
        </Inline>
        {mergeable && stance.kind === "held" && (
          <p id={heldId} className="text-muted-foreground text-xs">
            {t("pullRequests.heldHint", { why: t(`pullRequests.heldWhy.${stance.why}` as Key) })}
          </p>
        )}
        {stance.kind === "conflict" && !card.worktreePath && (
          <p className="text-muted-foreground text-xs">{t("pullRequests.conflictHint")}</p>
        )}
      </Stack>
    </li>
  );
}
