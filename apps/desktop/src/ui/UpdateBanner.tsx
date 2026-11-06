import { memo } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Inline } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useStoreSlice } from "@/lib/use-store";
import type { AppStore } from "../lib/app-store.ts";

const UPDATEBANNER_KEYS = ["appUpdate", "hosts", "settings"] as const;

/**
 * Phase 9: a newer app version on offer, with its notes, or why looking for one failed. With
 * daemons behind as well, it suggests updating the app first.
 */
export const UpdateBanner = memo(function UpdateBanner(props: { store: AppStore }) {
  const t = props.store.i18n.t;
  const { store } = props;
  const state = useStoreSlice(store, UPDATEBANNER_KEYS);
  const { offer, error } = state.appUpdate;
  // Issue #280: updating by itself, the banner waits until the new version is downloaded; once it
  // is, the corner card says so (issue #490), so the banner is left with the manual offer.
  const auto = state.settings.autoUpdate;
  if ((!offer || auto) && !error) return null;
  const daemonsBehind = state.hosts.some((h) => h.hostInfo?.update?.available);
  return (
    <section
      aria-label={t("update.label")}
      className="flex flex-col gap-2 border-b bg-secondary px-4 py-2 text-sm"
    >
      {offer && !auto && (
        <>
          <strong>{t("update.available", { version: offer.version })}</strong>
          {offer.notes && <p>{offer.notes}</p>}
          {daemonsBehind && <p className="text-muted-foreground text-xs">{t("update.first")}</p>}
          <Inline gap={2}>
            <ActionButton size="sm" onClick={() => store.installAppUpdate()}>
              {t("update.install")}
            </ActionButton>
            <Button variant="outline" size="sm" onClick={() => store.dismissAppUpdate()}>
              {t("update.later")}
            </Button>
          </Inline>
        </>
      )}
      {error && <p className="text-status-needs-you">{error}</p>}
    </section>
  );
});
