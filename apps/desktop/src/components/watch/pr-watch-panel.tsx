import { useEffect, useSyncExternalStore } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { sessionKey } from "@/lib/app-store";
import type { Key } from "../../i18n/index.ts";

/**
 * Phase 22: "Vigiar e consertar" on a card with an open PR: the switch, what the watch is
 * doing, the rounds of fixing with their result, and why the card asks for you.
 */
export function PrWatchPanel(props: { store: AppStore; hostId: string; cardId: string }) {
  const t = useT();
  const { store, hostId, cardId } = props;
  const watch = useSyncExternalStore(store.subscribe, store.getState).watches[
    sessionKey(hostId, cardId)
  ];
  useEffect(() => {
    void store.loadWatch(hostId, cardId);
  }, [store, hostId, cardId]);
  const on = watch?.enabled === true;
  return (
    <section className="flex flex-col gap-2 text-sm" aria-label={t("watchUi.switch")}>
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
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{t("watchUi.rounds")}</h3>
          <ul className="flex flex-col gap-1">
            {watch.rounds.map((round) => (
              <li key={round.id} className="flex flex-col">
                <span>
                  {t("watchUi.round", {
                    n: round.n,
                    status: t(`watchUi.status.${round.status}` as Key),
                  })}
                </span>
                {round.summary && (
                  <span className="text-muted-foreground text-xs">{round.summary}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
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
    </section>
  );
}
