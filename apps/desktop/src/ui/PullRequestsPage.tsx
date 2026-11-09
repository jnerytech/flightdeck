import { GitPullRequest } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CardMergePr } from "@/components/card/card-merge-pr";
import { Page } from "@/components/layout/page";
import { Stack } from "@/components/layout/stack";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { PrRefusal } from "@/components/pull-requests/pr-refusal";
import { PrRow } from "@/components/pull-requests/pr-row";
import { refusalText } from "@/i18n/errors";
import { type AppStore, sessionKey } from "../lib/app-store.ts";
import { openPullRequests } from "../lib/pull-requests.ts";
import type { Route } from "../lib/router.ts";
import { useStoreSlice } from "../lib/use-store.ts";
import { hasFeature } from "../lib/version.ts";

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
    for (const row of toWatch) void store.loadWatch(row.hostId, row.card.id);
  }, [store, watchKey]);

  const update = async (hostId: string, cardId: string) => {
    setRefusal(null);
    const result = await store.hostRequest(hostId, "card.updateFromBase", { cardId });
    if (!result.ok) {
      setRefusal(refusalText(result.code, result.message, t, result));
      return;
    }
    store.success(t("cardReview.updated"));
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
              onUpdate={() => update(row.hostId, row.card.id)}
            />
          );
        })}
      </Stack>
    );
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
