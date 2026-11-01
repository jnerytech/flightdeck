import { useEffect } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Stack } from "@/components/layout/stack";
import { useT } from "@/i18n/context";
import { type AppStore, sessionKey } from "@/lib/app-store";
import { useStoreState } from "@/lib/use-store";
import type { Key } from "../../i18n/index.ts";

/**
 * Phase 22: "Vigiar e consertar" on a card with an open PR: the switch, what the watch is
 * doing, the rounds of fixing with their result, and why the card asks for you.
 */
export function PrWatchPanel(props: { store: AppStore; hostId: string; cardId: string }) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const watch = useStoreState(store).watches[sessionKey(hostId, cardId)];
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
                  </Stack>
                </li>
              ))}
            </ul>
          </Stack>
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
