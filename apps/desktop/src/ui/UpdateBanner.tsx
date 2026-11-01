import { memo } from "react";
import { Button } from "@/components/ui/button";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";

const UPDATEBANNER_KEYS = ["appUpdate", "hosts"] as const;

/**
 * Phase 9: a newer app version on offer, with its notes, or why looking for one failed. With
 * daemons behind as well, it suggests updating the app first.
 */
export const UpdateBanner = memo(function UpdateBanner(props: { store: AppStore }) {
  const t = props.store.i18n.t;
  const { store } = props;
  const state = useStoreSlice(store, UPDATEBANNER_KEYS);
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
});
