import { GitPullRequest } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CardMergePr } from "./card-merge-pr.tsx";
import { ActionButton } from "@/components/feedback/action-button";
import { Page } from "@/components/layout/page";
import { Inline, Stack } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { refusalText } from "@/i18n/errors";
import { type AppStore, sessionKey } from "../../lib/app-store.ts";
import { bulkSplit, updateMany, updateSummary } from "../../lib/board-bulk.ts";
import { answerOf } from "../../lib/board-select.ts";
import { openPullRequests } from "../../lib/pull-requests.ts";
import type { Route } from "../../lib/router.ts";
import { useStoreSlice } from "../../lib/use-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { PrRefusal } from "./pr-refusal.tsx";
import { PrRow } from "./pr-row.tsx";

const SLICE = ["hosts", "projects", "cards", "watches"] as const;

/**
 * Every card with an open PR across the connected hosts (#1345): the checks, the watch, and Merge PR
 * (the card page's own confirm) and Update from the base, so a PR can be taken to the end without
 * visiting its board. The card's PR polling keeps the rows current; nothing here polls.
 */
export function PullRequestsPage(props: Readonly<{ store: AppStore; go(route: Route): void }>) {
  const { store, go } = props;
  const { t } = store.i18n;
  const state = useStoreSlice(store, SLICE);
  const rows = useMemo(() => openPullRequests(state), [state]);
  const [loaded, setLoaded] = useState(false);
  /** The card whose merge is being asked, or was last asked: its outcome stays above the list. */
  const [merging, setMerging] = useState<{ hostId: string; cardId: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const hostKey = state.hosts.map((h) => `${h.id}:${h.status}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the set of hosts or their status changes
  useEffect(() => {
    void store.loadPalette().finally(() => setLoaded(true));
  }, [store, hostKey]);

  // The watch of each card comes with the page, for the cards whose host watches and has none yet.
  const toWatch = rows.filter(
    (row) =>
      hasFeature(
        state.hosts.find((h) => h.id === row.hostId)?.hostInfo?.features,
        "watch",
        false,
      ) && !state.watches[sessionKey(row.hostId, row.card.id)],
  );
  const watchKey = toWatch.map((row) => sessionKey(row.hostId, row.card.id)).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `watchKey` names exactly the cards in `toWatch`
  useEffect(() => {
    for (const row of toWatch) void store.prWatch.load(row.hostId, row.card.id);
  }, [store, watchKey]);

  const update = async (hostId: string, cardId: string, title: string) => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "card.updateFromBase", { cardId });
    if (!result.ok) {
      const reason = refusalText(result.code, result.message, t, result);
      setRefusal(t("pullRequests.refused", { title, reason }));
      return;
    }
    store.success(t("cardReview.updated"));
  };

  /**
   * #1406: Update from the base for every listed PR that can take it (idle, with a branch), one card
   * at a time, each on its own host. The summary names the updated, current and conflicted cards.
   */
  const split = bulkSplit(
    rows.map((row) => row.card),
    t,
  );
  const updatable = split.update;
  /** #1500: the listed PRs the action leaves out, each with its reason, so "Update N" says which N. */
  const leftOut = split.skipUpdate
    .map(({ card, reason }) => `${card.title} (${reason})`)
    .join("; ");
  const leftOutId = useId();
  const [updating, setUpdating] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState("");
  const updateAll = useRef<HTMLButtonElement>(null);
  /** Runs finished: the button was off while each ran, so the focus goes back once it is on. */
  const [ran, setRan] = useState(0);
  useEffect(() => {
    if (ran > 0) updateAll.current?.focus();
  }, [ran]);
  const updateEvery = async () => {
    if (updating) return;
    const hostOf = new Map(rows.map((row) => [row.card, row.hostId]));
    const host = (card: (typeof updatable)[number]) => hostOf.get(card) ?? "";
    setRefusal(null);
    setSummary("");
    setUpdating({ done: 0, total: updatable.length });
    const results = await updateMany(updatable, {
      behind: async (card) => {
        const answer = await store.hostRequest(host(card), "changes.get", {
          target: `card:${card.id}`,
        });
        return answer.ok ? (answer.data.position?.behind ?? null) : null;
      },
      update: async (card) => {
        const answer = await store.hostRequest(host(card), "card.updateFromBase", {
          cardId: card.id,
        });
        return answer.ok ? { ok: true } : { ok: false, ...answerOf(answer) };
      },
      onProgress: (done, total) => setUpdating({ done, total }),
    });
    setSummary(updateSummary(t, results));
    setUpdating(null);
    setRan((n) => n + 1);
  };

  const target = merging ? state.cards[sessionKey(merging.hostId, merging.cardId)] : undefined;
  let body = null;
  if (rows.length > 0) {
    body = (
      <Stack as="ul" gap={2} label={t("pullRequests.list")}>
        {rows.map((row) => {
          const features = state.hosts.find((h) => h.id === row.hostId)?.hostInfo?.features;
          const key = sessionKey(row.hostId, row.card.id);
          return (
            <PrRow
              key={key}
              row={row}
              now={store.now()}
              watch={state.watches[key]}
              canMerge={hasFeature(features, "cardPrMerge", false)}
              withWatch={hasFeature(features, "watch", false)}
              onOpenCard={() =>
                go({
                  name: "card",
                  host: row.hostId,
                  projectId: row.card.projectId,
                  cardId: row.card.id,
                })
              }
              onOpenPr={() => store.openLink(row.card.prUrl ?? "")}
              onMerge={() => {
                setMerging({ hostId: row.hostId, cardId: row.card.id });
                setConfirming(true);
              }}
              onUpdate={() => update(row.hostId, row.card.id, row.card.title)}
            />
          );
        })}
      </Stack>
    );
  } else if (!state.hosts.some((host) => host.status === "online")) {
    body = <EmptyState icon={GitPullRequest} title={t("pullRequests.noHosts")} />;
  } else if (!loaded) {
    body = <LoadingState label={t("pullRequests.loading")} />;
  } else {
    body = (
      <EmptyState
        icon={GitPullRequest}
        title={t("pullRequests.empty")}
        detail={t("pullRequests.emptyDetail")}
      />
    );
  }
  return (
    <Page title={t("pullRequests.title")} subtitle={t("pullRequests.subtitle")}>
      <Stack gap={3}>
        {/* #1406: one row's own button is enough for a single PR. */}
        {updatable.length > 1 && (
          <Stack gap={1}>
            <Inline gap={2}>
              <ActionButton
                ref={updateAll}
                variant="outline"
                size="sm"
                disabled={updating !== null}
                aria-describedby={leftOut ? leftOutId : undefined}
                onClick={() => void updateEvery()}
              >
                {t("board.updateSelected", { n: updatable.length })}
              </ActionButton>
              {updating && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("board.updating", updating)}
                </span>
              )}
            </Inline>
            {leftOut && (
              <p id={leftOutId} className="break-words text-muted-foreground text-xs">
                {t("pullRequests.updateLeftOut", { items: leftOut })}
              </p>
            )}
          </Stack>
        )}
        <output className="block text-sm empty:hidden">{summary}</output>
        {refusal && <PrRefusal text={refusal} />}
        {merging && target && (
          <CardMergePr
            key={`${merging.hostId}/${merging.cardId}`}
            store={store}
            hostId={merging.hostId}
            card={target}
            open={confirming}
            onOpenChange={setConfirming}
          />
        )}
        {body}
      </Stack>
    </Page>
  );
}
