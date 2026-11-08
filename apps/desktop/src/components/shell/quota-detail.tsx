import { memo } from "react";
import { QuotaGuard } from "@/components/hosts/quota-guard";
import { Inline, Stack } from "@/components/layout/stack";
import { Meter } from "@/components/status/meter";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { quotaBars } from "@/lib/quota";
import { useStoreSlice } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";

const QUOTA_DETAIL_KEYS = ["quota", "hosts"] as const;

/**
 * What the status bar's quota opens (issue #1218): both windows of every online host with their
 * resets, the guard "new cards wait from N%" to change on each, and the way to what is running.
 */
export const QuotaDetail = memo(function QuotaDetail(
  props: Readonly<{ store: AppStore; hostId: string; onClose(): void }>,
) {
  const { store, hostId, onClose } = props;
  const t = useT();
  const state = useStoreSlice(store, QUOTA_DETAIL_KEYS);
  const hosts = state.hosts.filter(
    (host) => host.status === "online" && hasFeature(host.hostInfo?.features, "quota", false),
  );
  const go = (route: Parameters<typeof store.router.push>[0]) => {
    store.router.push(route);
    onClose();
  };
  return (
    <Stack gap={4}>
      {hosts.map((host) => {
        const quota = state.quota[host.id];
        return (
          <Stack key={host.id} gap={2} label={t("quota.region", { host: host.name })}>
            <h3 className="font-semibold text-sm">{host.name}</h3>
            {quotaBars(quota, store.now(), (iso) => store.formatTime(iso), t).map((bar) => (
              <Stack key={bar.window} gap={1}>
                <Inline gap={2}>
                  <span className="text-sm">{bar.label}</span>
                  {bar.hasReading && (
                    <span className="font-medium text-sm">{`${bar.percent}%`}</span>
                  )}
                </Inline>
                {bar.hasReading ? (
                  <>
                    <Meter
                      label={t("quota.meter", { window: bar.label, host: host.name })}
                      value={bar.value}
                      max={1}
                      hot={bar.hot}
                      className="w-full"
                    />
                    {bar.reset && (
                      <span className="text-muted-foreground text-xs">{bar.reset}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground text-xs">{t("quota.noReading")}</span>
                )}
              </Stack>
            ))}
            <QuotaGuard store={store} host={host} pauseAt={quota?.pauseAt ?? null} />
          </Stack>
        );
      })}
      <Inline gap={2}>
        <Button variant="outline" size="sm" onClick={() => go({ name: "activity" })}>
          {t("quota.popover.showRunning")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => go({ name: "host", host: hostId })}>
          {t("quota.popover.openHost")}
        </Button>
      </Inline>
    </Stack>
  );
});
