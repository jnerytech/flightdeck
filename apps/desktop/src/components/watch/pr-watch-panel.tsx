import { useEffect } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Inline, Stack } from "@/components/layout/stack";
import { useT } from "@/i18n/context";
import { type AppStore, sessionKey } from "@/lib/app-store";
import { useStoreState } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";
import type { Key } from "../../i18n/index.ts";

/** Issue #77: the rounds "Allow more rounds" gives at a time. */
const MORE_ROUNDS = 2;

/**
 * Phase 22: "Vigiar e consertar" on a card with an open PR: the switch, what the watch is
 * doing, the rounds of fixing with their result, and why the card asks for you.
 */
export function PrWatchPanel(props: Readonly<{ store: AppStore; hostId: string; cardId: string }>) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const state = useStoreState(store);
  const watch = state.watches[sessionKey(hostId, cardId)];
  const features = state.hosts.find((h) => h.id === hostId)?.hostInfo?.features;
  const canExtend = hasFeature(features, "watch.extend", false);
  const canResolve = hasFeature(features, "watch.resolveHeld", false);
  useEffect(() => {
    void store.loadWatch(hostId, cardId);
  }, [store, hostId, cardId]);
  const on = watch?.enabled === true;
  return (
    <section className="text-sm" aria-label={t("watchUi.switch")}>
      <Stack gap={2}>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => void store.setWatch(hostId, cardId, e.target.checked)}
          />
          {t("watchUi.switch")}
        </label>
        {on && watch?.status === "watching" && (
          <p className="text-muted-foreground">{t("watchUi.watching")}</p>
        )}
        {watch?.status === "needs_you" && (
          <p className="text-status-needs-you">
            {t("watchUi.needsYou", { reason: watch.reason ?? "" })}
          </p>
        )}
        {watch?.roundsUsed !== undefined && watch.maxRounds !== undefined && (
          <p className="text-muted-foreground">
            {t("watchUi.roundsUsed", { used: watch.roundsUsed, max: watch.maxRounds })}
          </p>
        )}
        {watch && watch.rounds.length > 0 && (
          <Stack gap={1}>
            <h3 className="font-medium">{t("watchUi.rounds")}</h3>
            <ul>
              {watch.rounds.map((round) => (
                <li key={round.id}>
                  <Stack gap={1}>
                    <span>
                      {t("watchUi.round", {
                        n: round.n,
                        status: t(`watchUi.status.${round.status}` as Key),
                      })}
                    </span>
                    {round.summary && (
                      <span className="text-muted-foreground text-xs">{round.summary}</span>
                    )}
                    {round.status === "held" && round.drift && (
                      <>
                        {round.drift.outside.length > 0 && (
                          <span className="text-xs">
                            {t("watchUi.outside", { files: round.drift.outside.join(", ") })}
                          </span>
                        )}
                        <span className="text-xs">
                          {t("watchUi.churn", {
                            churn: round.drift.churn,
                            limit: round.drift.limit,
                          })}
                        </span>
                      </>
                    )}
                    {round.status === "held" && canResolve && (
                      <Inline gap={2}>
                        <ActionButton
                          variant="outline"
                          size="sm"
                          onClick={() => store.resolveHeld(hostId, cardId, round.id, "push")}
                        >
                          {t("watchUi.pushHeld")}
                        </ActionButton>
                        <ActionButton
                          variant="outline"
                          size="sm"
                          onClick={() => store.resolveHeld(hostId, cardId, round.id, "drop")}
                        >
                          {t("watchUi.dropHeld")}
                        </ActionButton>
                      </Inline>
                    )}
                  </Stack>
                </li>
              ))}
            </ul>
          </Stack>
        )}
        {watch?.status === "needs_you" && canExtend && (
          <ActionButton
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => store.extendWatch(hostId, cardId, MORE_ROUNDS)}
          >
            {t("watchUi.extend", { n: MORE_ROUNDS })}
          </ActionButton>
        )}
        {watch?.status === "needs_you" && (
          <ActionButton
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => store.setWatch(hostId, cardId, true)}
          >
            {t("watchUi.resume")}
          </ActionButton>
        )}
      </Stack>
    </section>
  );
}
