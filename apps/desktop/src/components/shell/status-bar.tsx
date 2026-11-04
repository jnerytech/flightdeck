import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { quotaGlance } from "../../lib/status-bar.ts";

/**
 * The bottom bar of the app: the plan quota at a glance (the window under most pressure and the
 * time until it resets), the hosts online, and a refresh.
 */
export function StatusBar(props: {
  store: AppStore;
  state: Pick<AppState, "hosts" | "quota">;
  onRefresh(): void;
}) {
  const { t } = props.store.i18n;
  const { hosts, quota } = props.state;
  const online = hosts.filter((host) => host.status === "online");
  const glance = quotaGlance(
    quota,
    online.map((host) => host.id),
    props.store.now(),
  );
  const label = glance
    ? glance.remaining
      ? `${glance.percent}% · ${glance.remaining}`
      : `${glance.percent}%`
    : t("statusBar.noQuota");
  return (
    <section aria-label={t("statusBar.label")} className="status-bar">
      <span title={t("statusBar.quotaTitle")}>{label}</span>
      <span>{t("statusBar.hosts", { online: online.length, total: hosts.length })}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={t("statusBar.refresh")}
        onClick={props.onRefresh}
      >
        <RefreshCw aria-hidden="true" />
      </Button>
    </section>
  );
}
