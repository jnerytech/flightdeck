import { memo } from "react";
import { QuotaGuard } from "@/components/hosts/quota-guard";
import { Inline, Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { useStoreSlice } from "@/lib/use-store";
import { hasFeature } from "@/lib/version";
import { QuotaBarList } from "./quota-bars";

const QUOTA_DETAIL_KEYS = ["quota", "hosts"] as const;

/**
 * What the status bar's quota opens (issue #1218): both windows of every online host with their
 * resets, the guard "new cards wait from N%" to change on each, and the way to what is running.
 */
export const QuotaDetail = memo(function QuotaDetail(
  props: Readonly<{ store: AppStore; onClose(): void }>,
) {
  const { store, onClose } = props;
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
            <QuotaBarList store={store} host={host} quota={quota} />
            <QuotaGuard store={store} host={host} pauseAt={quota?.pauseAt ?? null} />
            <Inline gap={2}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("quota.popover.openHostOf", { host: host.name })}
                onClick={() => go({ name: "host", host: host.id })}
              >
                {t("quota.popover.openHost")}
              </Button>
            </Inline>
          </Stack>
        );
      })}
      <Inline gap={2}>
        <Button variant="outline" size="sm" onClick={() => go({ name: "activity" })}>
          {t("quota.popover.showRunning")}
        </Button>
      </Inline>
    </Stack>
  );
});
