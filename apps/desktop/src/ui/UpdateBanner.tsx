import { Button } from "@/components/ui/button";
import type { AppState, AppStore } from "../lib/app-store.ts";

/**
 * Phase 9: a newer app version on offer, with its notes, or why looking for one failed. With
 * daemons behind as well, it suggests updating the app first.
 */
export function UpdateBanner(props: { store: AppStore; state: AppState }) {
  const t = props.store.i18n.t;
  const { store, state } = props;
  const { offer, error } = state.appUpdate;
  if (!offer && !error) return null;
  const daemonsBehind = state.hosts.some((h) => h.hostInfo?.update?.available);
  return (
    <section
      aria-label={t("update.label")}
      className="flex flex-col gap-2 border-b bg-secondary px-4 py-2 text-sm"
    >
      {offer && (
        <>
          <strong>{t("update.available", { version: offer.version })}</strong>
          {offer.notes && <p>{offer.notes}</p>}
          {daemonsBehind && <p className="text-muted-foreground text-xs">{t("update.first")}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void store.installAppUpdate()}>
              {t("update.install")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => store.dismissAppUpdate()}>
              {t("update.later")}
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-status-needs-you">{error}</p>}
    </section>
  );
}
