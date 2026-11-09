import type { WatchInfo } from "@flightdeck/protocol";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { ActionButton } from "@/components/feedback/action-button";
import { Inline, Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import { canMergeCardPr } from "@/lib/card-merge-pr";
import type { PullRequestRow } from "@/lib/pull-requests";

const CHECK_ICONS = { passing: CircleCheck, pending: CircleDashed, failing: CircleAlert } as const;

/** What the card's watch is doing, in words; nothing when the host has no watch. */
function watchText(t: ReturnType<typeof useT>, watch: WatchInfo | undefined): string {
  if (watch?.status === "needs_you") return t("watchUi.needsYou", { reason: watch.reason ?? "" });
  return watch?.enabled ? t("watchUi.watching") : t("pullRequests.watchOff");
}

/**
 * One open PR: which card and where it lives, its checks and watch, and what can be done to it
 * from here. Merge asks first (the page holds the confirm); updating from the base shows the
 * host's refusal, which lists the files in conflict.
 */
export function PrRow(
  props: Readonly<{
    row: PullRequestRow;
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
  const { card } = props.row;
  const Checks = card.checksState ? CHECK_ICONS[card.checksState] : null;
  const where = [props.row.hostName, props.row.projectName].filter(Boolean).join(" · ");
  return (
    <li data-slot="pr-row" className="rounded-md border px-3 py-2 text-sm">
      <Stack gap={2}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h2 className="font-medium">
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
            <a
              href={card.prUrl ?? undefined}
              className="text-sm underline"
              onClick={(event) => {
                event.preventDefault();
                props.onOpenPr();
              }}
            >
              {t("cardMergePr.openPr")}
            </a>
          </Inline>
        </div>
        {props.withWatch && (
          <p className="text-muted-foreground text-xs">{watchText(t, props.watch)}</p>
        )}
        <Inline gap={2}>
          {props.canMerge && canMergeCardPr(card) && (
            <ActionButton size="sm" onClick={props.onMerge}>
              {t("cardMergePr.action")}
            </ActionButton>
          )}
          {card.worktreePath && (
            <ActionButton variant="outline" size="sm" onClick={props.onUpdate}>
              {t("cardReview.updateFromBase")}
            </ActionButton>
          )}
        </Inline>
      </Stack>
    </li>
  );
}
